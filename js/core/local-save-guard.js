// 同一オリジンの2タブが古い状態でlocalStorageを上書きしないための保存ガード。
// 排他的書込みの完全な実装ではない。競合を見つけたら停止し、サーバーrevisionでも保護する。
(function(root){
  "use strict";
  function hasExternalWrite(lastSavedAt,current){
    if(current===null||current===undefined)return false;
    try{
      const data=JSON.parse(current);
      if(!data||typeof data!=="object"||!Number.isSafeInteger(data.savedAt))return true;
      if(lastSavedAt===null||lastSavedAt===undefined)return true;
      return data.savedAt!==lastSavedAt;
    }catch{return true;}
  }
  const api={hasExternalWrite};
  root.QPCore=root.QPCore||{};root.QPCore.localSaveGuard=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
