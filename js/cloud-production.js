// 正式Web専用: 本人認証・App Check・版管理を持つサーバーAPIだけでクラウド保存。
// Previewは従来js/cloud.jsを利用。iOSのプロバイダー連携は別工程。
(function(root){
  "use strict";
  if(!root.QPRuntime||root.QPRuntime.channel!=="production")return;
  const state={status:"off",uid:null,lastUploadAt:null,lastUploadSavedAt:null,error:null};
  const subs=new Set(),BINDING="scprod:cloudBinding";
  const isWeb=root.QPRuntime.platform==="web";
  const config=root.QP_FIREBASE_CONFIG,endpoint=root.QP_API_CONFIG;
  let fb=null,auth=null,appCheck=null,starting=null,revision=null,uid=null;
  let pending=null,flight=null,timer=null,cloudCandidate=null;
  const INTERVAL=300000;
  function set(patch){Object.assign(state,patch);for(const fn of subs){try{fn({...state});}catch{}}}
  function readBinding(){try{return JSON.parse(root.localStorage.getItem(BINDING)||"null");}catch{return null;}}
  function storeBinding(){
    if(!uid||revision===null)return;
    try{root.localStorage.setItem(BINDING,JSON.stringify({uid,revision}));}catch{}
  }
  function localSave(){
    try{return root.QPCore.storage.defaultBackend().getItem(root.QPCore.storage.KEYS.save);}catch{return null;}
  }
  function loadSdk(){
    if(root.QPFirebase)return Promise.resolve(root.QPFirebase);
    return new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="js/vendor/firebase.js?v=1";
      script.onload=()=>root.QPFirebase?resolve(root.QPFirebase):reject(Error("Firebase SDKが読み込めません"));
      script.onerror=()=>reject(Error("Firebase SDKが読み込めません"));
      document.head.appendChild(script);
    });
  }
  async function send(path,method="GET",body){
    if(!auth?.currentUser||auth.currentUser.isAnonymous)throw Error("アカウント連携が必要です");
    const token=await fb.getIdToken(auth.currentUser);
    const appToken=(await fb.getToken(appCheck,false)).token;
    const res=await fetch(endpoint.baseUrl+path,{
      method,cache:"no-store",
      headers:{"Authorization":"Bearer "+token,"X-Firebase-AppCheck":appToken,"Content-Type":"application/json"},
      body:body?JSON.stringify(body):undefined,
    });
    let data;
    try{data=await res.json();}catch{throw Error("サーバーから不正な応答を受信しました");}
    if(!res.ok){
      const e=Error(res.status===409?"クラウドのセーブが別の端末で更新されています":data.error||"クラウド通信に失敗しました");
      e.status=res.status;
      throw e;
    }
    return data;
  }
  async function verifySession(){
    if(!auth?.currentUser||auth.currentUser.isAnonymous){
      uid=null;revision=null;pending=null;
      set({status:"needs-login",uid:null,error:null});
      return;
    }
    set({status:"connecting",error:null});
    uid=auth.currentUser.uid;
    await send("/v1/account");
    const cloud=await send("/v1/progress/backup");
    revision=cloud.revision;
    cloudCandidate=cloud;
    const safe=root.QPCloudBinding.canAutoUpload(revision,uid,readBinding());
    if(!safe){
      pending=null;
      set({status:"conflict",uid,error:"既存のクラウドセーブがあります。クラウドから復元するか、確認してこの端末の進行を採用してください。"});
    }else{
      set({status:"ready",uid,error:null});
      if(pending)schedule();
    }
  }
  async function start(){
    if(!isWeb){
      set({status:"error",error:"iOSのアカウント認証アダプターは未実装です。Web版でのみ連携できます。"});
      return;
    }
    if(!config||!endpoint?.baseUrl||!endpoint?.recaptchaSiteKey){
      set({status:"error",error:"本番バックアップの接続先が未設定です。"});return;
    }
    if(starting)return starting;
    starting=(async()=>{
      set({status:"connecting",error:null});
      try{
        if(!fb){
          fb=await loadSdk();
          const app=fb.initializeApp(config);
          auth=fb.initializeAuth(app,{persistence:[fb.indexedDBLocalPersistence,fb.browserLocalPersistence,fb.inMemoryPersistence]});
          appCheck=fb.initializeAppCheck(app,{
            provider:new fb.ReCaptchaV3Provider(endpoint.recaptchaSiteKey),
            isTokenAutoRefreshEnabled:true
          });
        }
        const user=await new Promise((resolve)=>{const off=fb.onAuthStateChanged(auth,u=>{off();resolve(u);});});
        if(user && !user.isAnonymous)await verifySession();
        else set({status:"needs-login",uid:null,error:null});
      }catch(e){set({status:"error",error:e.message||"接続に失敗しました"});}
      finally{starting=null;}
    })();
    return starting;
  }
  async function connectGoogle(){
    if(!fb || !auth)throw Error("クラウド接続の準備中です。もう一度操作してください");
    if(!isWeb)throw Error("Webブラウザから連携してください");
    const provider=new fb.GoogleAuthProvider();
    // 自動的な別accountIdへの統合をしない。同じ認証UIDのままリンクできる場合だけ昇格。
    if(auth.currentUser?.isAnonymous)await fb.linkWithPopup(auth.currentUser,provider);
    else await fb.signInWithPopup(auth,provider);
    await verifySession();
  }
  function schedule(){
    if(timer||state.status!=="ready")return;
    timer=setTimeout(()=>{timer=null;upload();},INTERVAL);
  }
  async function upload(){
    if(flight)return flight;
    if(state.status!=="ready"){set({error:"クラウドと端末の進行を確認してください"});return false;}
    if(!pending)return true;
    const current=pending;
    flight=(async()=>{
      try{
        const dto=root.QPCore.syncContract.progressDto(JSON.parse(current.json));
        const command={
          json:JSON.stringify(dto),savedAt:current.savedAt,
          expectedRevision:revision,operationId:root.crypto.randomUUID(),
        };
        const result=await send("/v1/progress/backup","POST",command);
        revision=result.revision;
        storeBinding();
        if(pending===current)pending=null;
        set({status:"ready",lastUploadAt:Date.now(),lastUploadSavedAt:current.savedAt,error:null});
        return true;
      }catch(e){
        set({status:e.status===409?"conflict":"error",error:e.message||"バックアップできません"});
        return false;
      }finally{
        flight=null;
        if(pending&&state.status==="ready")schedule();
      }
    })();
    return flight;
  }
  async function backupNow(){
    if(state.status==="off")await start();
    if(state.status!=="ready"){set({error:state.error||"連携またはセーブの競合確認が必要です"});return false;}
    if(typeof root.saveGame==="function"&&!root.saveGame())return false;
    clearTimeout(timer);timer=null;
    return upload();
  }
  async function fetchCloudSave(){
    if(state.status==="off")await start();
    if(!uid)throw Error("アカウント連携をしてください");
    const cloud=await send("/v1/progress/backup");
    revision=cloud.revision;cloudCandidate=cloud;
    if(!cloud.json)return null;
    return {json:cloud.json,savedAt:cloud.savedAt,updatedAt:cloud.updatedAt,revision:cloud.revision};
  }
  function markRestored(){storeBinding();}
  async function preferLocal(){
    if(!uid)throw Error("アカウント連携が必要です");
    // 確認後にリビジョンが変わった場合は再確認させる。
    const before=revision,cloud=await send("/v1/progress/backup");
    revision=cloud.revision;
    if(before!==revision){set({status:"conflict",error:"確認中に別の端末から保存されました。もう一度確認してください"});return false;}
    const local=localSave();
    if(!local)throw Error("端末にセーブがありません");
    pending={json:local,savedAt:JSON.parse(local).savedAt||Date.now()};
    set({status:"ready",error:null});
    return upload();
  }
  async function disconnect(){
    if(!fb||!auth)return;
    clearTimeout(timer);timer=null;pending=null;uid=null;revision=null;
    await fb.signOut(auth);
    set({status:"needs-login",uid:null,error:null,lastUploadAt:null});
  }
  root.addEventListener("qp:saved",ev=>{
    pending={json:ev.detail.json,savedAt:ev.detail.savedAt};
    if(state.status==="ready")schedule();
  });
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden&&pending&&state.status==="ready"){clearTimeout(timer);timer=null;upload();}
  });
  root.addEventListener("online",()=>{if(state.status==="error")start();});
  root.addEventListener("load",()=>setTimeout(start,1500));
  root.QPCloud={
    start,connectGoogle,disconnect,backupNow,fetchCloudSave,markRestored,preferLocal,
    getState:()=>({...state}),
    subscribe(fn){subs.add(fn);fn({...state});return()=>subs.delete(fn);}
  };
})(typeof globalThis!=="undefined"?globalThis:this);
