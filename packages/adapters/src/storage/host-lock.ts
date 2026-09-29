import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
/** Prevent two full-control supervisors from owning the same SQLite/workspace state. */
export async function acquireHostLock(root: string): Promise<() => Promise<void>> {
  const directory=resolve(root,"run");await mkdir(directory,{recursive:true});
  const path=resolve(directory,"agent.lock");const owner=randomUUID();
  for(let attempt=0;attempt<2;attempt++) {
    try {await writeFile(path,JSON.stringify({pid:process.pid,owner}),{flag:"wx",mode:0o600});
      return async()=>{try{const current=JSON.parse(await readFile(path,"utf8"));if(current.owner===owner)await unlink(path)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}};
    }catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      const current=JSON.parse(await readFile(path,"utf8")) as {pid?:unknown};
      if(typeof current.pid!=="number")throw new Error("Invalid host lock; inspect it manually");
      try{process.kill(current.pid,0);throw new Error("Another Synlet supervisor owns this data root")}catch(probe){if((probe as NodeJS.ErrnoException).code!=="ESRCH")throw probe;}
      await unlink(path).catch(e=>{if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e});
    }
  }
  throw new Error("Could not claim Synlet host lock");
}
