// 保存容量の非破壊診断。現行のセーブ本文を検査し、移行は実行しない。
(function(root){
  "use strict";
  // クラウドにある既存の1文書JSON文字数制限と同じ値。Firestoreの実際の
  // UTF-8ドキュメント容量とは別で、ここを通ってもアップロード成功の保証ではない。
  const CLOUD_MAX_SAVE_CHARS=900*1024;
  const CLOUD_MAX_SAVE_BYTES=900*1024;
  function byteLength(s){
    const text=String(s);
    if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
    if(typeof Buffer!=="undefined")return Buffer.byteLength(text,"utf8");
    if(typeof Blob!=="undefined")return new Blob([text]).size;
    // サイズが不明な環境は安全側に倒してクラウドの送信を止める。
    return null;
  }
  function formatBytes(n){
    if(!Number.isFinite(n)||n<0)return "取得不可";
    return (n/1024/1024).toFixed(2)+" MiB";
  }
  function cloudAccepts(json){
    const bytes=typeof json==="string"?byteLength(json):null;
    // Firestore文書の制限は文字数ではなくバイト単位。本文のUTF-8も確認する。
    return typeof json==="string"&&json.length<=CLOUD_MAX_SAVE_CHARS&&
      bytes!==null&&bytes<=CLOUD_MAX_SAVE_BYTES;
  }
  // 端末の未保存変更は測定に含めない。JSON以外のセーブ内容やユーザーIDは返さない。
  function analyze(json,opts){
    opts=opts||{};
    const valid=typeof json==="string"&&json.length>0;
    const chars=valid?json.length:0;
    const bytes=valid?byteLength(json):0;
    const estimate=opts.estimate||null;
    const usage=estimate&&Number.isFinite(estimate.usage)&&estimate.usage>=0?estimate.usage:null;
    const quota=estimate&&Number.isFinite(estimate.quota)&&estimate.quota>0?estimate.quota:null;
    return {
      saved:valid,characters:chars,utf8Bytes:bytes,
      inventoryCount:Number.isInteger(opts.inventoryCount)?opts.inventoryCount:null,
      cloudLimitChars:CLOUD_MAX_SAVE_CHARS,cloudLimitBytes:CLOUD_MAX_SAVE_BYTES,
      cloudEligible:valid?cloudAccepts(json):null,
      cloudRatio:valid?chars/CLOUD_MAX_SAVE_CHARS:null,
      originUsageBytes:usage,originQuotaBytes:quota,
      originQuotaRatio:usage!==null&&quota!==null?usage/quota:null,
      // storage.estimate()はオリジン全体の概算。localStorage単独の残量ではない。
      quotaIsApproximate:true,
      persisted:typeof opts.persisted==="boolean"?opts.persisted:null,
      indexedDBAvailable:opts.indexedDBAvailable===true,
      saveStorageBackend:"localStorage"
    };
  }
  function migrationReadiness(snapshot){
    // 将来のIndexedDB/SQLite移行前チェック。今は保存・削除・切替なし。
    return {
      proposedBackend:"IndexedDB (Web) / SQLite (iOS)",
      readyForImmediateCutover:false,
      sourcePresent:!!snapshot.saved,
      targetApiCandidate:!!snapshot.indexedDBAvailable,
      mandatorySteps:["旧localStorageを読み取り、データ内容とschemaVersionを検証",
        "新ストアへ別領域に書き込み、読み返して件数とハッシュを照合",
        "復元/オフライン精算の原子性とクラウド同期の衝突規則を検証",
        "新旧の併存期間・切り戻し条件を決める",
        "課金権利はローカル保存から独立したサーバー正本を維持"]
    };
  }
  const api={CLOUD_MAX_SAVE_CHARS,CLOUD_MAX_SAVE_BYTES,byteLength,formatBytes,cloudAccepts,analyze,migrationReadiness};
  root.QPCore=root.QPCore||{};
  root.QPCore.saveDiagnostics=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
