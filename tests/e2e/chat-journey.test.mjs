import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "../../apps/server/dist/index.js";
import { testProfile, testServices } from "../fixtures/test-profile.mjs";

test("real browser login, chat, follow-up and reload use the shared source-aware harness", {timeout: 60000}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-browser-journey-"));
  const seen = [];
  const model = {
    capabilities: async () => ({text:true,image:false,tools:false,structuredOutput:true,maxContextTokens:16384}),
    countInput: async (_id, prompt) => Math.ceil(prompt.length / 3),
    async *generate(request, signal) {
      signal.throwIfAborted(); seen.push(request);
      let value;
      if (request.requestId.includes("-skill-selection-")) value={skillId:null,reason:"test fixture"};
      else if (request.requestId.includes("-review-")) value={accepted:true,requiresMoreEvidence:false,feedback:"fixture only, not model quality"};
      else {
        const followup=request.prompt.includes("Repeat the earlier instruction and your reply");
        if(followup) {
          assert.match(request.prompt,/SESSION_NICKNAME_K23/u);
          assert.match(request.prompt,/ASSISTANT_REPLY_Q61/u);
        }
        value={type:"answer",content:followup?"SESSION_NICKNAME_K23 / ASSISTANT_REPLY_Q61":"ASSISTANT_REPLY_Q61",summary:"fixture response"};
      }
      yield {type:"text_delta",text:JSON.stringify(value)};
      yield {type:"done",finish:"stop",inputTokens:1,outputTokens:1};
    }
  };
  const app=await createServer({profile:testProfile,authToken:"browser-test-token",principal:{actorId:"actor-a",projectIds:["project-a"]},services:testServices({model,databasePath:join(root,"db.sqlite"),dataRoot:root,workspaceRoot:join(root,"workspace")})});
  await app.listen({host:"127.0.0.1",port:0});
  const address=app.server.address(); assert.ok(address && typeof address === "object");
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await app.close();await rm(root,{recursive:true,force:true});});
  const page=await browser.newPage();
  const posts=[]; page.on("request",request=>{if(request.method()==="POST")posts.push(new URL(request.url()).pathname);});
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.getByLabel("Operator token").fill("browser-test-token");
  await page.getByRole("button",{name:"Connect",exact:true}).click();
  await page.getByPlaceholder("Message Synlet…").fill("Remember SESSION_NICKNAME_K23 for this conversation.");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await page.getByText("ASSISTANT_REPLY_Q61",{exact:true}).waitFor();
  await page.getByPlaceholder("Message Synlet…").fill("Repeat the earlier instruction and your reply.");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await page.getByText("SESSION_NICKNAME_K23 / ASSISTANT_REPLY_Q61",{exact:true}).waitFor();
  await page.reload();
  await page.getByText("SESSION_NICKNAME_K23 / ASSISTANT_REPLY_Q61",{exact:true}).waitFor();
  assert.equal(posts.filter(path=>path==="/api/v1/agent-runs").length,2);
  assert.equal(posts.includes("/api/v1/tasks"),false);
  assert.ok(seen.filter(request=>request.requestId.includes("-plan-")).length>=2);
});
