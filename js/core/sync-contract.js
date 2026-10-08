// 本番バックアップAPIに渡す進行DTOと楽観ロック判定の純粋関数。
// 注意: クライアント上の判定は認可ではない。サーバーで本人確認・サイズ・版・原子的なrevision照合が必要。
(function(root){
  "use strict";
  const BILLING_KEYS = new Set(["purchases", "guaranteedStones", "jobGrants"]);
  function progressDto(saved){
    if(!saved || typeof saved !== "object" || Array.isArray(saved) || !Array.isArray(saved.roster)) throw new TypeError("Invalid save");
    if(!Number.isInteger(saved.schemaVersion) || saved.schemaVersion < 1) throw new TypeError("Missing save schemaVersion");
    // JSON複製で呼び出し元のセーブに変更を加えない。まだサーバーへの送信には使っていない。
    const data=JSON.parse(JSON.stringify(saved));
    for(const k of BILLING_KEYS) delete data[k];
    return data;
  }
  // APIはexpectedRevisionに一致する場合のみ原子的に更新する。関数単独に排他制御能力はない。
  function revisionDecision({expectedRevision,currentRevision,operationId,payloadHash,previousOperation}){
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!Number.isSafeInteger(currentRevision)||currentRevision<0) return {status:"invalid",httpStatus:400};
    if(typeof operationId!=="string" || operationId.length<1 || operationId.length>128 || typeof payloadHash!=="string" || !payloadHash) return {status:"invalid",httpStatus:400};
    if(previousOperation && previousOperation.operationId===operationId){
      if(previousOperation.payloadHash !== payloadHash) return {status:"mismatch",httpStatus:409};
      return {status:"replay",httpStatus:200,revision:previousOperation.resultRevision};
    }
    if(expectedRevision!==currentRevision) return {status:"conflict",httpStatus:409,revision:currentRevision};
    return {status:"accept",httpStatus:200,nextRevision:currentRevision+1};
  }
  const exported={progressDto,revisionDecision};
  root.QPCore=root.QPCore||{};root.QPCore.syncContract=exported;
  if(typeof module!=="undefined" && module.exports) module.exports=exported;
})(typeof globalThis!=="undefined"?globalThis:this);
