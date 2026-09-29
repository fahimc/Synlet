import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAnswer, summarizeResults } from "../../scripts/eval-harness.mjs";

test("evaluation uses exact independent text and JSON oracles", () => {
  assert.equal(evaluateAnswer("unverified", {kind:"exact_text",value:"verified"}), false);
  assert.equal(evaluateAnswer("This is not local-only", {kind:"exact_text",value:"local-only"}), false);
  assert.equal(evaluateAnswer('{"a":false,"b":0}', {kind:"exact_json",value:{b:0,a:false}}), true);
  assert.equal(evaluateAnswer('{"a":"false","b":0}', {kind:"exact_json",value:{a:false,b:0}}), false);
  assert.equal(evaluateAnswer('{"a":false,"b":0,"extra":true}', {kind:"exact_json",value:{a:false,b:0}}), false);
  assert.equal(evaluateAnswer('```json\n{"a":1}\n```', {kind:"exact_json",value:{a:1}}), false);
});

test("numeric oracle rejects substrings, unsupported prose, NaN and excessive error", () => {
  const oracle={kind:"number",value:42};
  for(const output of ["142","42 or 41","not 42","NaN","Infinity"]) assert.equal(evaluateAnswer(output,oracle),false);
  assert.equal(evaluateAnswer(" 42 ",oracle),true);
  assert.equal(evaluateAnswer("42.01",{...oracle,absoluteTolerance:0.001}),false);
  assert.equal(evaluateAnswer("42.0001",{...oracle,absoluteTolerance:0.001}),true);
  assert.throws(()=>evaluateAnswer("anything",{kind:"unknown"}));
});

test("failed and skipped cases remain visible and do not become passing samples", () => {
  assert.deepEqual(summarizeResults([]),{samples:0,passed:0,failed:0,skipped:0,successRate:null,p50Ms:null,p95Ms:null});
  assert.deepEqual(summarizeResults([{status:"PASS",elapsedMs:10},{status:"FAIL",elapsedMs:30},{status:"SKIPPED"}]),{samples:2,passed:1,failed:1,skipped:1,successRate:0.5,p50Ms:10,p95Ms:30});
});
