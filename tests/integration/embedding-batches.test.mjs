import assert from "node:assert/strict";
import test from "node:test";
import { SourceService } from "../../packages/core/dist/index.js";

const access={actorId:"a",projectId:"p",policyVersion:"full-control/v1"};
function fixture(failAt=Infinity){let next=0;const batches=[];let added=0;let deleted=0;const index=[];
 const store={add:async({source})=>{added++;return source},artifactReferenceCount:async()=>0};
 const artifacts={writeText:async text=>({hash:"a".repeat(64),bytes:Buffer.byteLength(text)}),delete:async()=>{deleted++}};
 const embed={embed:async request=>{batches.push(request.inputs.length);if(batches.length===failAt)throw Error("worker failed");assert.ok(request.inputs.length<=64);return{modelVersion:"fixture-v1",vectors:request.inputs.map(()=>[1,0,0])}}};
 const service=new SourceService(store,artifacts,{next:p=>`${p}-${++next}`},{now:()=>new Date().toISOString()},1048576,embed,{upsert:(...args)=>index.push(args)});
 return{service,batches,index,get added(){return added},get deleted(){return deleted}};
}
test("a 102401-byte document is split into valid 64+1 embedding batches",async()=>{const f=fixture();await f.service.ingest({title:"large",kind:"text",content:"x".repeat(102401)},access);assert.deepEqual(f.batches,[64,1]);assert.equal(f.added,1);assert.equal(f.index.length,65)});
test("failed embedding batch commits no partial source and removes unreferenced artifact",async()=>{const f=fixture(2);await assert.rejects(f.service.ingest({title:"large",kind:"text",content:"x".repeat(102401)},access),/worker failed/u);assert.equal(f.added,0);assert.equal(f.index.length,0);assert.equal(f.deleted,1)});
