// Web/PWAの同一originで書込みを1タブに制限するWeb Locksセッション。
// LockManagerを使えない環境はFail Closed: 書込みを許可しない。
// Storageの保存時刻ガードとサーバーrevision検証も併用し、別端末への同期を守る。
(function(root){
  "use strict";
  const LOCK_NAME="swordcrest-production-game-session-v1";
  function createSessionLock(manager,onStateChange){
    let state="idle",release=null,pending=null;
    const notify=s=>{state=s;if(onStateChange)onStateChange(s);};
    function start(){
      if(state==="held"||state==="pending")return pending;
      if(!manager||typeof manager.request!=="function"){
        notify("unsupported");return Promise.resolve(false);
      }
      notify("pending");
      pending=Promise.resolve().then(()=>manager.request(LOCK_NAME,{mode:"exclusive",ifAvailable:true},async lock=>{
        if(!lock){notify("blocked");return false;}
        if(state!=="pending")return false;
        notify("held");
        await new Promise(resolve=>{release=resolve;});
        release=null;
        if(state==="held")notify("released");
        return true;
      })).catch(()=>{notify("failed");return false;}).finally(()=>{pending=null;});
      return pending;
    }
    function stop(){
      if(state==="pending")notify("released");
      if(state==="held"){notify("released");const unlock=release;if(unlock)unlock();}
    }
    return {start,stop,getState:()=>state,owns:()=>state==="held"};
  }
  const api={LOCK_NAME,createSessionLock};
  root.QPCore=root.QPCore||{};root.QPCore.tabSession=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
