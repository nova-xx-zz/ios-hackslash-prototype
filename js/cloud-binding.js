// 本番の自動クラウド保存は、端末が最後に確認した所有者/版と一致する場合だけ可能。
(function(root){
  "use strict";
  function canAutoUpload(revision,uid,binding){
    if(!Number.isSafeInteger(revision)||revision<0||typeof uid!=="string"||!uid)return false;
    // 別アカウントでログインし直した場合、クラウドが空でも端末の進行を勝手に送らない。
    if(binding && binding.uid!==uid)return false;
    if(revision===0)return true;
    return !!binding && binding.revision===revision;
  }
  const exported={canAutoUpload};
  root.QPCloudBinding=exported;
  if(typeof module!=="undefined"&&module.exports)module.exports=exported;
})(typeof globalThis!=="undefined"?globalThis:this);
