// 入力・認証/所有者・保存の契約。Firebase SDKに依存しないためNodeで単体テスト可能。
"use strict";
const crypto=require("node:crypto");
const LIMIT_BYTES=700*1024;
const MAX_SCHEMA_VERSION=2;
const PAID_KEYS=["purchases","guaranteedStones","jobGrants"];
class ApiError extends Error{
  constructor(status,code,message){super(message||code);this.status=status;this.code=code;}
}
function parseSave(input){
  if(typeof input!=="string" || Buffer.byteLength(input,"utf8")>LIMIT_BYTES)throw new ApiError(413,"save_too_large");
  let data;
  try{data=JSON.parse(input);}catch{throw new ApiError(400,"invalid_json");}
  if(!data||typeof data!=="object"||Array.isArray(data)||!Array.isArray(data.roster))throw new ApiError(400,"invalid_save");
  if(data.roster.length===0||data.roster.length>500)throw new ApiError(400,"invalid_roster");
  if(!Number.isInteger(data.schemaVersion)||data.schemaVersion<1||data.schemaVersion>MAX_SCHEMA_VERSION)throw new ApiError(409,"unsupported_schema");
  for(const key of PAID_KEYS)if(Object.prototype.hasOwnProperty.call(data,key))throw new ApiError(400,"financial_fields_forbidden");
  // 進行データの真正性までは検証しない。課金権利はサーバーの別台帳に置く。
  return JSON.stringify(data);
}
function validateWrite(body){
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ApiError(400,"invalid_request");
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new ApiError(400,"invalid_revision");
  if(typeof body.operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(body.operationId))throw new ApiError(400,"invalid_operation");
  if(!Number.isSafeInteger(body.savedAt)||body.savedAt<0)throw new ApiError(400,"invalid_timestamp");
  const json=parseSave(body.json);
  const hash=crypto.createHash("sha256").update(JSON.stringify({expectedRevision:body.expectedRevision,savedAt:body.savedAt,json})).digest("hex");
  return {expectedRevision:body.expectedRevision,operationId:body.operationId,savedAt:body.savedAt,json,hash};
}
function createBackupService({verifyToken,repository,newId=()=>crypto.randomUUID()}){
  if(typeof verifyToken!=="function"||!repository)throw new Error("Missing injected auth or repository");
  async function account(idToken){
    if(typeof idToken!=="string"||idToken.length>5000)throw new ApiError(401,"missing_auth");
    let claims;
    try{claims=await verifyToken(idToken);}catch{throw new ApiError(401,"invalid_auth");}
    if(!claims||typeof claims.uid!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(claims.uid))throw new ApiError(401,"invalid_auth");
    // 匿名状態では保存権利を作らない。連携先が既存accountならUIDを無断統合しない。
    if(claims.firebase?.sign_in_provider==="anonymous")throw new ApiError(403,"account_link_required");
    const row=await repository.getOrCreateAccount(claims.uid,{accountId:newId(),billingId:newId()});
    if(!row || typeof row.accountId!=="string" || typeof row.billingId!=="string")throw new ApiError(500,"account_unavailable");
    return {accountId:row.accountId,billingId:row.billingId};
  }
  return {
    async getAccount(token){return account(token);},
    async getBackup(token){
      const owner=await account(token);
      const saved=await repository.readBackup(owner.accountId);
      return saved||{revision:0,json:null,savedAt:null,updatedAt:null};
    },
    async putBackup(token,input){
      const owner=await account(token);
      const validated=validateWrite(input);
      const result=await repository.commitBackup(owner.accountId,validated);
      if(result.status==="conflict")throw new ApiError(409,"revision_conflict");
      if(result.status==="mismatch")throw new ApiError(409,"operation_reused");
      if(result.status!=="accept"&&result.status!=="replay")throw new ApiError(500,"backup_unavailable");
      return {revision:result.revision,status:result.status};
    }
  };
}
module.exports={ApiError,parseSave,validateWrite,createBackupService,LIMIT_BYTES,MAX_SCHEMA_VERSION};
