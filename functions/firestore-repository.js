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
      const op=db.doc("progressBackups/"+accountId+"/operations/"+input.operationId);
      return db.runTransaction(async tx=>{
        // Firestoreトランザクションは全てのreadがwriteより先に必要。
        const [seen,saved]=await Promise.all([tx.get(op),tx.get(parent)]);
        if(seen.exists){
          const old=seen.data();
          if(old.hash!==input.hash)return {status:"mismatch",revision:old.revision};
          return {status:"replay",revision:old.revision};
        }
        const current=saved.exists?saved.data().revision:0;
        if(!Number.isSafeInteger(current)||current<0)throw Error("Corrupt revision");
        if(input.expectedRevision!==current)return {status:"conflict",revision:current};
        const revision=current+1;
        tx.set(parent,{revision,json:input.json,savedAt:input.savedAt,updatedAt:serverTimestamp()});
        tx.create(op,{hash:input.hash,revision,createdAt:serverTimestamp()});
        return {status:"accept",revision};
      });
    }
  };
}
module.exports={createFirestoreRepository};
