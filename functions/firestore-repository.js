// Firestoreバックアップ: 読取はaccountIdのみ、更新と再送判定は1トランザクション。
"use strict";
function createFirestoreRepository(db,serverTimestamp){
  return {
    async getOrCreateAccount(uid,newIds){
      const subject=db.doc("authSubjects/"+uid);
      return db.runTransaction(async tx=>{
        const existing=await tx.get(subject);
        if(existing.exists)return {accountId:existing.data().accountId,billingId:existing.data().billingId};
        const values={accountId:newIds.accountId,billingId:newIds.billingId};
        tx.create(subject,values);
        tx.create(db.doc("accounts/"+values.accountId),{...values,createdAt:serverTimestamp()});
        return values;
      });
    },
    async readBackup(accountId){
      const doc=await db.doc("progressBackups/"+accountId).get();
      if(!doc.exists)return null;
      const saved=doc.data();
      return {revision:saved.revision,json:saved.json,savedAt:saved.savedAt,
        updatedAt:saved.updatedAt?.toMillis?.()??null};
    },
    async commitBackup(accountId,input){
      const parent=db.doc("progressBackups/"+accountId);
      return db.runTransaction(async tx=>{
        // セーブの直近操作だけをバックアップ本体に記録する。
        // 消耗品課金の永続台帳と違い、進行バックアップの操作ログを無期限増加させない。
        const saved=await tx.get(parent);
        const previous=saved.exists?saved.data():null;
        const last=previous?.lastOperation;
        if(last?.operationId===input.operationId){
          if(last.hash!==input.hash)return {status:"mismatch",revision:last.revision};
          return {status:"replay",revision:last.revision};
        }
        const current=previous?previous.revision:0;
        if(!Number.isSafeInteger(current)||current<0)throw Error("Corrupt revision");
        if(input.expectedRevision!==current)return {status:"conflict",revision:current};
        const revision=current+1;
        tx.set(parent,{
          revision,json:input.json,savedAt:input.savedAt,updatedAt:serverTimestamp(),
          lastOperation:{operationId:input.operationId,hash:input.hash,revision}
        });
        return {status:"accept",revision};
      });
    }
  };
}
module.exports={createFirestoreRepository};
