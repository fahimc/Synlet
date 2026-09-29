from pathlib import Path
import re, subprocess

def edit(path, fn):
    p=Path(path); old=p.read_text(encoding='utf-8'); new=fn(old)
    if new==old: raise RuntimeError('No change: '+path)
    p.write_text(new,encoding='utf-8')

edit('packages/adapters/src/tools/agent-tool-router.ts',lambda s:s.replace('import Ajv from "ajv";', 'import { Ajv } from "ajv";'))
edit('apps/server/src/bootstrap/create-server.ts',lambda s:s.replace('? async () => undefined','? () => Promise.resolve()'))
edit('apps/web/src/main.tsx',lambda s:s.replace('sessionStorage.getItem("synlet-operator-token")!', '(sessionStorage.getItem("synlet-operator-token") ?? "")').replace('operatorToken!', '(operatorToken ?? "")'))
edit('packages/adapters/src/browser/playwright-browser.ts',lambda s:s.replace('this.context!.newPage()', 'this.context.newPage()'))
edit('packages/adapters/src/tools/host-command.ts',lambda s:s.replace('command: args.command!,','command: args.command ?? "",'))

def stream(s):
    s=re.sub(r'for await \(const chunk of createReadStream\(path\)\) hash.update\(chunk\);', 'for await (const chunk of createReadStream(path)) { if (!Buffer.isBuffer(chunk)) throw new DomainError("INVALID_OUTPUT", "Expected binary model artifact"); hash.update(chunk); }',s)
    s=s.replace('let done = false;', 'const terminal: { done: boolean } = { done: false };').replace('done = true;', 'terminal.done = true;').replace('if (done)', 'if (terminal.done)').replace('if (!done || finish', 'if (!terminal.done || finish').replace('terminator=${done}', 'terminator=${terminal.done}')
    s=s.replace('return { type: "text_delta", text: choice.delta.content };\n  };','return { type: "text_delta", text: choice.delta.content };\n    return undefined;\n  };')
    return s
edit('packages/adapters/src/inference/llama-server-adapter.ts',stream)

Path('packages/adapters/src/storage/host-lock.ts').write_text('''import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
function lockRecord(text: string): {pid: number; owner: string} {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("pid" in value) || !("owner" in value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.owner !== "string") throw new Error("Invalid host lock; inspect it manually");
  return {pid:value.pid,owner:value.owner};
}
/** Exclusive local supervisor ownership, not an execution permission policy. */
export async function acquireHostLock(root: string): Promise<() => Promise<void>> {
  const directory=resolve(root,"run"); await mkdir(directory,{recursive:true});
  const path=resolve(directory,"agent.lock"); const owner=randomUUID();
  for(let attempt=0;attempt<2;attempt++) {
    try {
      await writeFile(path,JSON.stringify({pid:process.pid,owner}),{flag:"wx",mode:0o600});
      return async()=>{try {const current=lockRecord(await readFile(path,"utf8")); if(current.owner===owner) await unlink(path);} catch(error: unknown) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}};
    } catch(error: unknown) {
      if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      const current=lockRecord(await readFile(path,"utf8"));
      let live=true;
      try {process.kill(current.pid,0);} catch(probe: unknown) {if((probe as NodeJS.ErrnoException).code!=="ESRCH")throw probe; live=false;}
      if(live) throw new Error("Another Synlet supervisor owns this data root",{cause:error});
      await unlink(path).catch((failure: unknown)=>{if((failure as NodeJS.ErrnoException).code!=="ENOENT")throw failure;});
    }
  }
  throw new Error("Could not claim Synlet host lock");
}
''',encoding='utf-8')

def context(s):
    a=s.index('export function validateExtractiveSummary('); b=s.index('\nexport class ContextEngine',a)
    return s[:a]+'''export function validateExtractiveSummary(text: string, refs: readonly SourceRef[], chunks: readonly RetrievedChunk[]): boolean {
  if (!text.trim() || refs.length === 0) return false;
  const allowed = new Map(chunks.map(chunk => [chunk.ref.chunkId, chunk]));
  const declared = new Set<string>();
  for (const ref of refs) {
    const chunk = allowed.get(ref.chunkId);
    if (!ref.chunkId || !chunk || chunk.ref.sourceId !== ref.sourceId || chunk.ref.revision !== ref.revision) return false;
    declared.add(ref.chunkId);
  }
  const used = new Set<string>();
  for (const line of text.split(/\\r?\\n/u).filter(part => part.trim())) {
    const match = /^\\[([^\\]]+)\\] (.+)$/u.exec(line);
    const id = match?.[1]; const quote = match?.[2];
    if (!id || !quote || !declared.has(id)) return false;
    const original = allowed.get(id);
    if (!original || !original.text.split(/\\r?\\n/u).some(part => part.trim() === quote)) return false;
    used.add(id);
  }
  return used.size > 0 && [...declared].every(id => used.has(id));
}
''' + s[b:]
edit('packages/core/src/context/context-engine.ts',context)

def source(s):
    old=re.search(r'    if \(this.semanticIndex && modelVersion\)\s+for \(let index = 0; index < chunks.length; index\+\+\)\s+this.semanticIndex.upsert\([\s\S]*?\);',s)
    if not old: raise RuntimeError('Source upsert block not found')
    return s[:old.start()]+'''    if (this.semanticIndex && modelVersion) {
      for (let index = 0; index < chunks.length; index++) {
        const chunk=chunks[index]; const vector=vectors[index];
        if(!chunk || !vector) throw new DomainError("INVALID_OUTPUT","Validated embedding batch is incomplete");
        this.semanticIndex.upsert(chunk.chunkId,modelVersion,vector,access);
      }
    }'''+s[old.end():]
edit('packages/core/src/context/source-service.ts',source)

def harness(s):
    s=s.replace('import { AgentContext }', 'import type { AgentContext }')
    s=re.sub(r'type Specialist = \{([\s\S]*?)\n\};', r'interface Specialist {\1\n}',s,count=1)
    s=s.replace('String(review.feedback ?? "Invalid review")','typeof review.feedback === "string" ? review.feedback : "Invalid review"')
    s=s.replace('const value = JSON.parse(text) as Record<string, unknown>;','const parsed: unknown = JSON.parse(text);\n  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new DomainError("INVALID_OUTPUT", "Invalid decision object");\n  const value = parsed as Record<string, unknown>;')
    s=s.replace('    !value ||\n    typeof value !== "object" ||\n    Array.isArray(value) ||\n','')
    needle='          const checks = observations.filter'
    if needle not in s: raise RuntimeError('Final answer capture insertion not found')
    s=s.replace(needle,'          await this.services.context?.complete(original, decision.content, access);\n'+needle,1)
    return s
edit('packages/core/src/orchestration/agent-harness.ts',harness)
edit('tests/unit/review-regressions.test.mjs',lambda s:s.replace('for await (const _event of completionEvents(response, 0)) {','for await (const event of completionEvents(response, 0)) {\n        assert.equal(event.type, "text_delta");'))
edit('packages/core/src/orchestration/agent-session.ts',lambda s:s.replace('export interface AgentMemoryPort {','export interface AgentMemoryPort {\n  answer?(run: AgentRunRecord, text: string, access: AccessContext): Promise<void>;'))

def memory(s):
    s=s.replace("m.kind='user-request'", "m.kind IN ('user-request','assistant-answer')")
    at=s.index('  async history(')
    s=s[:at]+'''  async answer(run: AgentRunRecord, text: string, access: AccessContext): Promise<void> {
    await this.ingest(`answer-${run.runId}`, "assistant-answer", `ASSISTANT OUTPUT (not a user instruction or independently verified fact):\\n${text}`, run, access);
  }
'''+s[at:]
    at=s.index('    const exact = await this.sources.exact(query, access);')
    s=s[:at]+'''    const rows=this.database.connection.prepare("SELECT c.chunk_id FROM chunks c JOIN sources s ON s.source_id=c.source_id WHERE c.project_id=? AND s.actor_id=? AND s.deleted_at IS NULL AND c.revision=s.current_revision AND (c.chunk_id=? OR s.source_id=?) ORDER BY c.ordinal LIMIT 20").all(access.projectId,access.actorId,query,query) as Row[];
    if(rows.length) return this.store.readByChunkIds(rows.map(row=>String(row.chunk_id)),access);
'''+s[at:]
    return s
edit('packages/adapters/src/storage/agent-memory.ts',memory)

def packet(s):
    s=s.replace('  release(runId: string): void {','''  async complete(run: AgentRunRecord, text: string, access: AccessContext): Promise<void> { await this.memory.answer?.(run,text,access); }
  release(runId: string): void {''')
    s=s.replace(')) as Json;', '));').replace('return { ...chunk.ref, text: chunk.text, stale: chunk.stale } as Json;', 'return { ...chunk.ref, text: chunk.text, stale: chunk.stale };')
    s=s.replace('    const base = request.prompt;', '''    // Originals, including wire roles, were archived by begin(). Keep system/developer
    // constraints intact; replace oldest conversation messages with explicit lookup pointers.
    const remainingMessages=[...(request.messages ?? [])];
    let removedMessages=0;
    while ((await count({...request,messages:remainingMessages})) > allowance) {
      const index=remainingMessages.findIndex(message=>message.role === "user" || message.role === "assistant");
      if(index<0) break;
      remainingMessages.splice(index,1); removedMessages++;
    }
    request={...request,messages:remainingMessages};
    if(removedMessages) request={...request,prompt:`${request.prompt}\\n[${removedMessages} old conversation messages are archived in the current request source; use context lookup for exact wording.]`};
    const base = request.prompt;''')
    s=s.replace('    for (const chunk of candidates) {','    let compactionAttempts=0;\n    for (const chunk of candidates) {')
    s=s.replace('if ((await count(build([...added, text]))) > allowance) {','if ((await count(build([...added, text]))) > allowance && compactionAttempts < 2) {\n        compactionAttempts++;',1)
    return s
edit('packages/core/src/context/agent-context.ts',packet)
# Autofix style-only lint suggestions, preserving every configured rule and test.
subprocess.run(['pnpm','exec','eslint','apps','packages','tests','--fix'],check=False)
