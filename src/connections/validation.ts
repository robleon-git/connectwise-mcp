import { Worker } from "node:worker_threads";
import { ConnectionError, type ConnectionFailure } from "./errors.js";
import type { ConnectionInput } from "./validation-transport.js";
export { GLOBAL_CLIENT_ID, type ConnectionInput } from "./validation-transport.js";
const failures = new Set<ConnectionFailure>(["invalid_url","unsafe_destination","unreachable_host","tls_failure","authentication_failed","connectwise_rejected"]);

// A separate JS realm lets the unchanged MCP client use the pinned transport without
// private-field reflection or altering fetch/dispatchers in the control API process.
export async function validateConnection(input:ConnectionInput):Promise<void> {
  const failed=new ConnectionError("unreachable_host");
  let worker:Worker;
  try {
    worker=new Worker(new URL("./validation-worker.js",import.meta.url),{workerData:input,stdout:true,stderr:true});
  } catch {throw failed;}
  // Never relay worker diagnostic output, exceptions or arbitrary messages.
  worker.stdout.resume();worker.stderr.resume();
  try {
    await new Promise<void>((accept,reject)=>{
      const timer=setTimeout(()=>reject(failed),10000);
      function finish(error?:ConnectionError){clearTimeout(timer);if(error)reject(error);else accept();}
      worker.once("error",()=>finish(failed));
      worker.once("exit",()=>finish(failed));
      worker.once("message",(message:unknown)=>{
        if(!message||typeof message!=="object"){finish(failed);return;}
        const result=message as {ok?:unknown;code?:unknown};
        if(result.ok===true&&Object.keys(result).length===1){finish();return;}
        if(result.ok===false&&Object.keys(result).length===2&&typeof result.code==="string"&&failures.has(result.code as ConnectionFailure)){
          finish(new ConnectionError(result.code as ConnectionFailure));return;
        }
        finish(failed);
      });
    });
  } finally {await worker.terminate().catch(()=>{throw failed;});}
}
