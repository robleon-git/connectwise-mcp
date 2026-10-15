import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration } from "./common.mjs";
import { receiptConfiguration } from "./migration-breadcrumbs.mjs";
import { receiptStore } from "../../dist/database/migrationReceiptStore.js";
export const noListCondition = "!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})";
export function receiptResources(c, store) {
  receiptStore(store);
  const group = `/subscriptions/${c.subscriptionId}/resourceGroups/${c.resourceGroup}`;
  const accountScope = `${group}/providers/Microsoft.Storage/storageAccounts/${store.account}`;
  const containerScope = `${accountScope}/blobServices/default/containers/${store.container}`;
  const role = (name,Actions,DataActions) => ({Name:name,IsCustom:true,Description:"Isolated migration receipt access",Actions,NotActions:[],DataActions,NotDataActions:[],AssignableScopes:[group]});
  return {
    account:{name:store.account,location:c.location,kind:"StorageV2",sku:{name:"Standard_LRS"},properties:{allowBlobPublicAccess:false,allowSharedKeyAccess:false,supportsHttpsTrafficOnly:true,minimumTlsVersion:"TLS1_2"}},
    service:{name:"default",properties:{isVersioningEnabled:false,deleteRetentionPolicy:{enabled:false},containerDeleteRetentionPolicy:{enabled:false},restorePolicy:{enabled:false}}},
    container:{name:store.container,properties:{publicAccess:"None"}},
    lifecycle:{name:"default",properties:{policy:{rules:[{name:"expire-migration-receipts",enabled:true,type:"Lifecycle",definition:{filters:{blobTypes:["blockBlob"],prefixMatch:[`${store.container}/v1/`]},actions:{baseBlob:{delete:{daysAfterModificationGreaterThan:30}}}}}]}}},
    jobCreator:role("ConnectWise migration receipt creator",[],["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action"]),
    githubReader:role("ConnectWise migration receipt reader",[],["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read"]),
    githubConfigurationReader:role("ConnectWise receipt configuration reader",["Microsoft.Storage/storageAccounts/read","Microsoft.Storage/storageAccounts/blobServices/read","Microsoft.Storage/storageAccounts/blobServices/containers/read","Microsoft.Storage/storageAccounts/managementPolicies/read"],[]),
    scopes:{account:accountScope,container:containerScope},githubReadCondition:noListCondition,conditionVersion:"2.0"
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proposal=receiptResources(await configuration(),await receiptConfiguration());
    await mkdir(".delivery",{recursive:true});await writeFile(".delivery/migration-receipt-resources.json",JSON.stringify(proposal,null,2)+"\n");
    console.log(JSON.stringify({receiptResourcesRendered:true,liveResourcesChanged:false}));
  } catch {console.error(JSON.stringify({receiptResourcesRendered:false}));process.exitCode=1;}
}
