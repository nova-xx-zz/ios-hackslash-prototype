// クラウドバックアップの履歴と間隔の純粋なポリシー。端末セーブには介入しない。
(function(root){
  "use strict";
  const AUTO_INTERVAL_MS=24*60*60*1000;
  const MAX_AUTO=5,MAX_MANUAL=5,MAX_ENTRIES=MAX_AUTO+MAX_MANUAL;
  const ID_RE=/^[a-f0-9-]{32,36}$/;
  const HASH_RE=/^[a-f0-9]{64}$/;
  function valid(entry){
    return entry&&ID_RE.test(entry.id)&&["auto","manual"].includes(entry.kind)&&
      Number.isSafeInteger(entry.createdAt)&&entry.createdAt>0&&
      Number.isSafeInteger(entry.savedAt)&&entry.savedAt>=0&&
      HASH_RE.test(entry.sha256)&&["gzip","plain"].includes(entry.encoding)&&
      Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=32*1024*1024;
  }
  function validate(entries){
    if(!Array.isArray(entries)||entries.length>MAX_ENTRIES||
       entries.some(e=>!valid(e))||new Set(entries.map(e=>e.id)).size!==entries.length||
       entries.filter(e=>e.kind==="auto").length>MAX_AUTO||
       entries.filter(e=>e.kind==="manual").length>MAX_MANUAL){
      throw new Error("バックアップ一覧が不正です");
    }
    return entries.map(e=>({...e}));
  }
  function autoDue(entries,now){
    const all=validate(entries).filter(e=>e.kind==="auto");
    if(!all.length)return true;
    const last=Math.max(...all.map(e=>e.createdAt));
    // 端末の時計が過去に戻った場合も多重バックアップを防ぐ。
    return Number.isSafeInteger(now)&&now>=last+AUTO_INTERVAL_MS;
  }
  function plan(entries,newEntry){
    const previous=validate(entries);
    if(!valid(newEntry)||previous.some(e=>e.id===newEntry.id))throw new Error("バックアップ情報が不正です");
    if(newEntry.kind==="manual"&&previous.filter(e=>e.kind==="manual").length>=MAX_MANUAL){
      throw new Error("手動バックアップは5件までです。古い履歴を削除してから保存してください");
    }
    const next=[...previous,newEntry];
    let removed=[];
    if(newEntry.kind==="auto"){
      const autos=next.filter(e=>e.kind==="auto").sort((a,b)=>b.createdAt-a.createdAt);
      removed=autos.slice(MAX_AUTO);
    }
    const stale=new Set(removed.map(e=>e.id));
    return {entries:next.filter(e=>!stale.has(e.id)),removed};
  }
  const api={AUTO_INTERVAL_MS,MAX_AUTO,MAX_MANUAL,validate,autoDue,plan};
  root.QPCore=root.QPCore||{};
  root.QPCore.backupHistory=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
