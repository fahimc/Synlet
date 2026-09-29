import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FullControlFiles, runHostCommand } from "../../packages/adapters/dist/index.js";

test("full-control file tools write, edit and delete outside configured workspace",async t=>{
 const root=await mkdtemp(join(tmpdir(),"synlet-full-control-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace=join(root,"workspace");await mkdir(workspace);
 const tools=new FullControlFiles(workspace);const path=join(root,"outside.txt");
 const first=await tools.execute("file.write",{path,content:"one"});
 assert.equal(await readFile(path,"utf8"),"one");
 await tools.execute("file.patch",{path,content:"two",expectedSha256:first.sha256});
 assert.equal(await readFile(path,"utf8"),"two");
 await tools.execute("file.delete",{path});await assert.rejects(access(path));
});

test("shell accepts arbitrary commands, cwd and harmless stderr without semantic routes",async t=>{
 const root=await mkdtemp(join(tmpdir(),"synlet-shell-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const command=process.platform==="win32" ? "[Console]::Out.Write('novel-marker-739'); [Console]::Error.Write('warning-only')" : "printf novel-marker-739; printf warning-only >&2";
 const result=await runHostCommand({command,cwd:root},root);
 assert.equal(result.ok,true);assert.match(result.stdout,/novel-marker-739/u);assert.match(result.stderr,/warning-only/u);
 const compound=process.platform==="win32" ? "$n=13*17; [Console]::Write($n)" : "n=$((13*17)); printf '%s' \"$n\"";
 assert.equal((await runHostCommand({command:compound},root)).stdout.trim(),"221");
});

test("cancel waits for shell termination and reports unknown external effects",async()=>{
 const controller=new AbortController();
 const command=process.platform==="win32" ? "Start-Sleep -Seconds 20" : "sleep 20";
 const timer=setTimeout(()=>controller.abort(),100);
 try{const result=await runHostCommand({command,timeoutMs:30000},tmpdir(),controller.signal);assert.equal(result.cancelled,true);assert.equal(result.outcomeUnknown,true);assert.equal(result.ok,false);}finally{clearTimeout(timer)}
});
