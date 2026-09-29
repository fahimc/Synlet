import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Independent answer checks. No substring, word-overlap or model self-approval oracle. */
export function evaluateAnswer(answer, oracle) {
  if (typeof answer !== "string" || !oracle || typeof oracle !== "object") return false;
  const text = answer.trim();
  if (oracle.kind === "exact_text") return text === oracle.value;
  if (oracle.kind === "exact_json") {
    try { return isDeepStrictEqual(JSON.parse(text), oracle.value); }
    catch { return false; }
  }
  if (oracle.kind === "number") {
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) return false;
    const value = Number(text);
    const tolerance = oracle.absoluteTolerance ?? 0;
    return Number.isFinite(value) && Number.isFinite(oracle.value) && Number.isFinite(tolerance) && tolerance >= 0 && Math.abs(value - oracle.value) <= tolerance;
  }
  throw new Error("Unknown oracle; refusing an ungraded passing case");
}

export function summarizeResults(results) {
  const attempted = results.filter(row => row.status !== "SKIPPED");
  const times = attempted.map(row => row.elapsedMs).filter(Number.isFinite).sort((a,b) => a-b);
  const percentile = fraction => times.length ? times[Math.max(0, Math.ceil(times.length*fraction)-1)] : null;
  const passed = attempted.filter(row => row.status === "PASS").length;
  return { samples: attempted.length, passed, failed: attempted.length-passed, skipped: results.length-attempted.length, successRate: attempted.length ? passed/attempted.length : null, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
}

async function main() {
  const file = resolve(process.argv[2] ?? "evals/harness-regressions.json");
  const bytes = await readFile(file);
  if (bytes.length > 32*1024*1024) throw new Error("Evaluation manifest exceeds 32 MiB");
  const suite = JSON.parse(bytes.toString("utf8"));
  if (suite.schemaVersion !== "synlet.harness-eval/v1" || !Array.isArray(suite.cases) || suite.cases.length < 1 || suite.cases.length > 1000) throw new Error("Invalid evaluation suite");
  const base = new URL(process.env.SYNLET_LIVE_BASE_URL ?? "http://127.0.0.1:43127");
  if (!["http:","https:"].includes(base.protocol) || base.username || base.password) throw new Error("Use an HTTP(S) endpoint without URL credentials");
  const token = process.env.SYNLET_LIVE_AUTH_TOKEN;
  if (!token) throw new Error("Set SYNLET_LIVE_AUTH_TOKEN locally; never commit it");
  const headers = { authorization:`Bearer ${token}`, "content-type":"application/json" };
  const deadlineMs = Number(process.env.SYNLET_EVAL_TIMEOUT_MS ?? 360000);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 3600000) throw new Error("Invalid evaluation timeout");
  async function api(path, init={}) {
    const response = await fetch(new URL(path,base), {...init, headers:{...headers,...init.headers}, signal:AbortSignal.timeout(30000)});
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.code ?? "request failed"}`);
    return result;
  }
  const models = await api("/api/v1/models");
  const results=[];
  const sessionPrefix = `eval-${randomUUID()}`;
  for (const item of suite.cases) {
    if (typeof item.id !== "string" || !item.id || !Array.isArray(item.turns) || item.turns.length < 1 || item.turns.length > 64 || !item.oracle) throw new Error("Invalid case definition");
    const started=performance.now();
    let active;
    const turns=[];
    try {
      for (const [index, turn] of item.turns.entries()) {
        if (typeof turn.prompt !== "string" || !turn.prompt.trim()) throw new Error("Each turn needs a prompt");
        const run=await api("/api/v1/agent-runs", {method:"POST",headers:{"idempotency-key":`${sessionPrefix}-${item.id}-${index}`},body:JSON.stringify({sessionId:`${sessionPrefix}-${item.id}`.slice(0,128),prompt:turn.prompt,...(turn.images?{images:turn.images}:{})})});
        active=run.runId;
        const deadline=Date.now()+deadlineMs;
        let status=run;
        while(status.status === "running" && Date.now()<deadline) {
          await new Promise(done=>setTimeout(done,250));
          status=await api(`/api/v1/agent-runs/${run.runId}`);
        }
        if(status.status === "running") throw new Error("Evaluation deadline reached");
        active=undefined;
        const events=[];
        let after=0;
        for(let page=0;page<100;page++) {
          const batch=await api(`/api/v1/agent-runs/${run.runId}/events?after=${after}`);
          if(!Array.isArray(batch)) throw new Error("Invalid event response");
          events.push(...batch);
          if(!batch.length) break;
          const next=batch.at(-1).sequence;
          if(next<=after) throw new Error("Event cursor did not advance");
          after=next;
          if(batch.length<512) break;
        }
        turns.push({runId:run.runId,status:status.status,answer:status.result,events});
        if(status.status !== "completed") throw new Error(`Agent finished ${status.status}`);
      }
      const answer=turns.at(-1).answer ?? "";
      results.push({id:item.id,category:item.category ?? "unspecified",status:evaluateAnswer(answer,item.oracle)?"PASS":"FAIL",elapsedMs:performance.now()-started,turns});
    } catch(error) {
      let cancellation="not needed";
      if(active) {
        try { await api(`/api/v1/agent-runs/${active}/cancel`,{method:"POST",body:"{}"}); cancellation="acknowledged; inspect any outcome-unknown effects"; }
        catch { cancellation="UNCONFIRMED: operator must inspect the run"; }
      }
      results.push({id:item.id,category:item.category ?? "unspecified",status:"FAIL",elapsedMs:performance.now()-started,error:error instanceof Error?error.message:String(error),cancellation,turns});
    }
    process.stdout.write(`${item.id}: ${results.at(-1).status}\n`);
  }
  const report={schemaVersion:"synlet.harness-eval-report/v1",evidence:"MEASURED_END_TO_END_REGRESSION_NOT_GENERAL_BENCHMARK",createdAt:new Date().toISOString(),suiteSha256:createHash("sha256").update(bytes).digest("hex"),suiteName:suite.name,endpoint:base.origin,profileLabel:process.env.SYNLET_EVAL_PROFILE_LABEL ?? "UNSPECIFIED",serviceCommit:process.env.SYNLET_EVAL_SERVICE_COMMIT ?? "NOT_ATTESTED",models,summary:summarizeResults(results),results};
  await mkdir("reports",{recursive:true});
  const output=resolve("reports",`harness-eval-${Date.now()}.json`);
  await writeFile(output,`${JSON.stringify(report,null,2)}\n`);
  process.stdout.write(`${JSON.stringify(report.summary)}\nReport: ${output}\n`);
  if(report.summary.failed) process.exitCode=1;
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
}
