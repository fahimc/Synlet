import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarness } from "../../packages/core/dist/index.js";

test("controller-only comparison bypasses classifiers but not arbitrary LLM tool choices", async () => {
  const records=new Map(); const events=[]; const requests=[]; const executed=[]; let sequence=0; let plans=0;
  const runs={
    async create(run){records.set(run.runId,run);return run;},
    async get(id){return records.get(id);},
    async append(event){const row={...event,sequence:++sequence};events.push(row);return row;},
    async finish(id,status,result,now){const next={...records.get(id),status,result,updatedAt:now};records.set(id,next);return next;}
  };
  const arbitraryCommand="a-model-selected-command --arbitrary-argument";
  const model={
    async *generate(request,signal){
      signal.throwIfAborted(); requests.push(request);
      assert.equal(request.modelId,"controller");
      assert.equal(request.requestId.includes("skill-selection"),false);
      let value;
      if(request.requestId.includes("review-"))value={accepted:true,requiresMoreEvidence:false,feedback:"fixture evidence"};
      else if(plans++ === 0)value={type:"tool",tool:"command.run",arguments:{command:arbitraryCommand},summary:"model chose this command"};
      else value={type:"answer",content:"observed baseline result",summary:"done"};
      yield {type:"text_delta",text:JSON.stringify(value)};
      yield {type:"done",finish:"stop",inputTokens:1,outputTokens:1};
    }
  };
  const harness=new AgentHarness(runs,model,{
    async catalog(){return [{id:"command.run",title:"Shell",description:"Unrestricted shell",inputSchema:{type:"object",properties:{command:{type:"string"}},required:["command"]},source:"host"}];},
    async execute(tool,args){executed.push({tool,args});return {ok:true,exitCode:0,stdout:"observed baseline result"};}
  },{async route(){assert.fail("A baseline must not invoke Julia");}},async()=>[],{next:prefix=>`${prefix}-${++sequence}`},{now:()=>new Date().toISOString()},{modelId:"controller",selectorModelId:"not-invoked",modelStrategy:"controller-only",maxSteps:4,maxOutputTokens:512,timeoutMs:5000,reasoning:"enabled",specialists:[]});
  const access={actorId:"a",projectId:"p",policyVersion:"full-control/v1"};
  const run=await harness.start({sessionId:"s",prompt:"Inspect the host however you judge appropriate."},access);
  for(let i=0;i<100 && records.get(run.runId).status === "running";i++)await new Promise(done=>setImmediate(done));
  assert.equal(records.get(run.runId).status,"completed",records.get(run.runId).result);
  assert.deepEqual(executed,[{tool:"command.run",args:{command:arbitraryCommand}}]);
  assert.ok(requests.length>=3);
  assert.ok(events.some(event=>event.data?.modelStrategy === "controller-only"));
  await harness.close();
});
