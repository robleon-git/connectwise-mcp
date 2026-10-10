import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { runValidation, type ConnectionInput } from "./validation-transport.js";
import { normalizeTarget } from "../security/outbound-target.js";
import { ConnectionError } from "./errors.js";
if(isMainThread||!parentPort)throw new Error("validation_worker_required");
try {
  const input=workerData as ConnectionInput;
  const target=normalizeTarget(input.baseUrl);
  if(target.hostname!==input.hostname)throw new ConnectionError("unsafe_destination");
  await runValidation(input,async(client,transport)=>{
    // This worker handles one request only. The main thread and other workers retain their own fetch.
    globalThis.fetch=transport;
    await client.get("/system/info");
  });
  parentPort.postMessage({ok:true});
} catch(error) {
  parentPort.postMessage({ok:false,code:error instanceof ConnectionError?error.code:"unreachable_host"});
} finally {parentPort.close();}
