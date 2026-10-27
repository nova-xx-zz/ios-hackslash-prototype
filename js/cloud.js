// Firebase匿名認証＋Cloud Storageに保存する世代別クラウドバックアップ。
// ローカルのjobquest_save_v1/20秒間隔セーブ/オフライン精算は一切変更しない。
// ※Storage・Firestoreルールのデプロイ前は新方式のアップロードは不可。旧saves/{uid}は読み取り専用で維持。
(function(root){
  "use strict";
  if(root.QPCore&&root.QPCore.storage&&
     (root.QPCore.storage.isDebugMode()||root.QPCore.storage.isDungeonPilotMode()))return;
  const policy=root.QPCore.backupHistory;
  const START_DELAY_MS=1500,RETRY_MS=60*1000,MAX_BYTES=32*1024*1024;
  const SDK_URL="js/vendor/firebase.js?v=1";
  const state={status:"off",uid:null,lastUploadAt:null,lastUploadSavedAt:null,error:null};
  const listeners=new Set();
  let fb=null,auth=null,db=null,starting=null,uploading=null,autoTimer=null;
  let latestSave=null,indexCache=null,retryAt=0;

  function set(patch){
    Object.assign(state,patch);
    for(const fn of listeners){try{fn({...state});}catch(_){}}
  }
  function errorText(error){
    if(!root.navigator||root.navigator.onLine===false)return "ネットワークにつながっていません";
    const c=error&&error.code;
    if(c==="permission-denied"||c==="storage/unauthorized"||c==="storage/unauthenticated")
      return "バックアップへのアクセスが拒否されました（Firebaseルール・認証を確認してください）";
    if(c==="auth/configuration-not-found"||c==="auth/operation-not-allowed")return "Firebase匿名ログインが有効ではありません";
    if(c==="sdk-load-failed")return "クラウド接続の読み込みに失敗しました";
    return error&&error.message?String(error.message):"クラウドバックアップに失敗しました";
  }
  function loadSdk(){
    if(root.QPFirebase)return Promise.resolve(root.QPFirebase);
    return new Promise((resolve,reject)=>{
      const s=root.document.createElement("script");s.src=SDK_URL;
      s.onload=()=>root.QPFirebase?resolve(root.QPFirebase):reject({code:"sdk-load-failed"});
      s.onerror=()=>reject({code:"sdk-load-failed"});root.document.head.appendChild(s);
    });
  }
  async function readIndex(){
    const snap=await fb.getDoc(fb.doc(db,"backupIndexes",state.uid));
    const value=snap.exists()?snap.data():null;
    if(value&&(value.formatVersion!==1||!Array.isArray(value.entries)))throw Error("クラウド保存一覧が不正です");
    const entries=policy.validate(value?value.entries:[]);
    indexCache=entries;
    const newest=entries.reduce((a,e)=>!a||e.createdAt>a.createdAt?e:a,null);
    set({lastUploadAt:newest?newest.createdAt:null,lastUploadSavedAt:newest?newest.savedAt:null});
    return entries;
  }
  async function start(){
    if(state.status==="ready")return;
    if(starting)return starting;
    if(!root.QP_FIREBASE_CONFIG){set({status:"error",error:"Firebaseの設定がありません"});return;}
    set({status:"connecting",error:null});
    starting=(async()=>{
      try{
        if(!fb){
          fb=await loadSdk();
          const app=fb.initializeApp(root.QP_FIREBASE_CONFIG);
          auth=fb.initializeAuth(app,{persistence:[
            fb.indexedDBLocalPersistence,fb.browserLocalPersistence,fb.inMemoryPersistence
          ]});
          db=fb.getFirestore(app);
        }
        const current=await new Promise(resolve=>{
          const stop=fb.onAuthStateChanged(auth,u=>{stop();resolve(u);});
        });
        const user=current||(await fb.signInAnonymously(auth)).user;
        set({status:"ready",uid:user.uid,error:null});
        await readIndex();
        scheduleAuto();
      }catch(e){
        set({status:"error",error:errorText(e)});
      }finally{starting=null;}
    })();
    return starting;
  }
  function currentJson(){
    if(latestSave&&typeof latestSave.json==="string")return latestSave.json;
    // 起動直後の手動操作用。正本キーは従来どおりで、保存の書換えは行わない。
    const key=root.QPCore.storage.KEYS.save;
    return root.localStorage&&root.localStorage.getItem(key);
  }
  function validateSave(json){
    if(typeof json!=="string"||!json)throw Error("端末に保存済みのセーブがありません");
    if(!root.QPModel||!root.QPModel.save||!root.QPModel.save.prepareRestore(json))
      throw Error("セーブの内容を検証できません");
    return json;
  }
  async function digest(json){
    if(!root.crypto||!root.crypto.subtle)throw Error("SHA-256が利用できません");
    const bytes=new root.TextEncoder().encode(json);
    const hash=await root.crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function encode(json){
    const raw=new root.TextEncoder().encode(json);
    if(raw.byteLength>MAX_BYTES)throw Error("セーブ容量が32MiBを超えています");
    if(typeof root.CompressionStream==="function"){
      const stream=new root.Blob([raw]).stream().pipeThrough(new root.CompressionStream("gzip"));
      const bytes=new Uint8Array(await new root.Response(stream).arrayBuffer());
      return {bytes,encoding:"gzip"};
    }
    return {bytes:raw,encoding:"plain"};
  }
  async function decode(bytes,entry){
    let raw=bytes;
    if(entry.encoding==="gzip"){
      if(typeof root.DecompressionStream!=="function")throw Error("この端末ではgzip復元に対応していません");
      const stream=new root.Blob([bytes]).stream().pipeThrough(new root.DecompressionStream("gzip"));
      raw=new Uint8Array(await new root.Response(stream).arrayBuffer());
    }
    if(raw.byteLength>MAX_BYTES)throw Error("復元データが容量上限を超えています");
    const json=new root.TextDecoder("utf-8",{fatal:true}).decode(raw);
    if(await digest(json)!==entry.sha256)throw Error("バックアップの整合性検証に失敗しました");
    return validateSave(json);
  }
  function storageUrl(id,media){
    const config=root.QP_FIREBASE_CONFIG;
    if(!config||!config.storageBucket)throw Error("Firebase Storageの設定がありません");
    if(!/^[a-f0-9-]{32,36}$/.test(id))throw Error("不正なバックアップIDです");
    const name="swordcrest-backups/"+state.uid+"/"+id;
    const base="https://firebasestorage.googleapis.com/v0/b/"+
      encodeURIComponent(config.storageBucket)+"/o";
    return media==="upload"?base+"?name="+encodeURIComponent(name):
      base+"/"+encodeURIComponent(name)+(media==="get"?"?alt=media":"");
  }
  async function request(id,method,bytes){
    const user=auth&&auth.currentUser;
    if(!user||typeof user.getIdToken!=="function")throw Error("バックアップ用の認証情報がありません");
    const token=await user.getIdToken();
    const kind=method==="POST"?"upload":method==="GET"?"get":"delete";
    const headers={"Authorization":"Firebase "+token,
      "X-Firebase-Storage-Version":"webjs/12.19.0"};
    if(root.QP_FIREBASE_CONFIG.appId)headers["X-Firebase-GMPID"]=root.QP_FIREBASE_CONFIG.appId;
    let body;
    if(bytes){
      // Firebase Storage Web SDKと同じmultipart形式。生のバイト列だけのPOSTは送らない。
      const boundary="scbackup"+id.replace(/-/g,"");
      const name="swordcrest-backups/"+state.uid+"/"+id;
      headers["X-Goog-Upload-Protocol"]="multipart";
      headers["Content-Type"]="multipart/related; boundary="+boundary;
      const pre="--"+boundary+"\\r\\nContent-Type: application/json; charset=utf-8\\r\\n\\r\\n"+
        JSON.stringify({name,contentType:"application/octet-stream"})+
        "\\r\\n--"+boundary+"\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n";
      const post="\\r\\n--"+boundary+"--";
      body=new root.Blob([pre,bytes,post]);
    }
    const response=await root.fetch(storageUrl(id,kind),{
      method,headers,...(body?{body}:{})
    });
    if(!response.ok)throw Error("Cloud Storage通信に失敗しました（HTTP "+response.status+"）");
    return method==="GET"?new Uint8Array(await response.arrayBuffer()):null;
  }
  async function putAndVerify(entry,bytes,json){
    await request(entry.id,"POST",bytes);
    const returned=await request(entry.id,"GET");
    if(returned.byteLength!==entry.bytes||await decode(returned,entry)!==json)
      throw Error("アップロード後の読み戻しが一致しません");
  }
  function newId(){
    if(root.crypto&&typeof root.crypto.randomUUID==="function")return root.crypto.randomUUID();
    if(!root.crypto||typeof root.crypto.getRandomValues!=="function")throw Error("安全な世代IDを作成できません");
    const bytes=new Uint8Array(16);root.crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function commitIndex(entries){
    await fb.setDoc(fb.doc(db,"backupIndexes",state.uid),{
      formatVersion:1,entries,updatedAt:fb.serverTimestamp()
    });
    indexCache=entries;
    const newest=entries.reduce((a,e)=>!a||e.createdAt>a.createdAt?e:a,null);
    set({lastUploadAt:newest?newest.createdAt:null,lastUploadSavedAt:newest?newest.savedAt:null,error:null});
  }
  async function doBackup(kind,json){
    const entries=await readIndex();
    if(kind==="auto"&&!policy.autoDue(entries,Date.now()))return true;
    // 満杯の手動履歴はアップロード前に拒否する。
    if(kind==="manual"&&entries.filter(e=>e.kind==="manual").length>=policy.MAX_MANUAL)
      throw Error("手動バックアップは5件までです。履歴を削除してから保存してください");
    validateSave(json);
    const encoded=await encode(json);
    const candidate={
      id:newId(),kind,createdAt:Date.now(),
      savedAt:(JSON.parse(json).savedAt||Date.now()),
      sha256:await digest(json),encoding:encoded.encoding,bytes:encoded.bytes.byteLength
    };
    const plan=policy.plan(entries,candidate);
    await putAndVerify(candidate,encoded.bytes,json);
    // 旧一覧を先に削除しない。新オブジェクトが完全一致するまで確定しない。
    await commitIndex(plan.entries);
    for(const entry of plan.removed){
      try{await request(entry.id,"DELETE");}catch(_){/* 別途クリーンアップ対象。履歴は正常 */ }
    }
    return true;
  }
  function cancelAuto(){if(autoTimer!==null){root.clearTimeout(autoTimer);autoTimer=null;}}
  function scheduleAuto(){
    cancelAuto();
    if(state.status!=="ready"||!latestSave||uploading)return;
    const entries=indexCache||[];
    const last=entries.filter(e=>e.kind==="auto").reduce((max,e)=>Math.max(max,e.createdAt),0);
    const now=Date.now();
    const delay=Math.max(0,last?last+policy.AUTO_INTERVAL_MS-now:0,retryAt-now);
    autoTimer=root.setTimeout(()=>{autoTimer=null;autoBackup();},delay);
  }
  async function autoBackup(){
    if(uploading||state.status!=="ready"||!latestSave)return false;
    if(root.navigator&&root.navigator.onLine===false){
      retryAt=Date.now()+RETRY_MS;scheduleAuto();return false;
    }
    uploading=(async()=>{
      try{
        const ok=await doBackup("auto",latestSave.json);
        retryAt=0;return ok;
      }catch(e){
        retryAt=Date.now()+RETRY_MS;
        set({error:errorText(e)});return false;
      }
    })();
    try{return await uploading;}finally{uploading=null;scheduleAuto();}
  }
  async function backupNow(){
    if(state.status!=="ready")await start();
    if(state.status!=="ready")return false;
    if(typeof root.saveGame==="function"&&!root.saveGame()){
      set({error:"端末への保存が失敗したためクラウドには送信しません"});return false;
    }
    if(uploading)await uploading;
    cancelAuto();
    uploading=(async()=>{
      try{return await doBackup("manual",currentJson());}
      catch(e){set({error:errorText(e)});return false;}
    })();
    try{return await uploading;}finally{uploading=null;scheduleAuto();}
  }
  async function listBackups(){
    if(state.status!=="ready")await start();
    if(state.status!=="ready")throw Error(state.error||"クラウドに接続できません");
    return (await readIndex()).slice().sort((a,b)=>b.createdAt-a.createdAt);
  }
  async function fetchCloudSave(id){
    if(state.status!=="ready")await start();
    if(state.status!=="ready")throw Error(state.error||"クラウドに接続できません");
    try{
      const entries=await readIndex();
      const target=id?entries.find(e=>e.id===id):
        entries.slice().sort((a,b)=>b.createdAt-a.createdAt)[0];
      if(id&&!target)throw Error("選択したバックアップが見つかりません");
      if(target){
        const bytes=await request(target.id,"GET");
        if(bytes.byteLength!==target.bytes)throw Error("バックアップのデータサイズが一致しません");
        return {json:await decode(bytes,target),savedAt:target.savedAt,updatedAt:target.createdAt};
      }
      // 旧バージョンの単一Firestoreドキュメントは消さず、復元専用の互換口として残す。
      const snap=await fb.getDoc(fb.doc(db,"saves",state.uid));
      if(!snap.exists())return null;
      const data=snap.data();
      return {json:validateSave(data.data),savedAt:data.savedAt||null,
        updatedAt:data.updatedAt&&data.updatedAt.toMillis?data.updatedAt.toMillis():null};
    }catch(e){throw Error(errorText(e));}
  }
  async function deleteBackup(id){
    if(state.status!=="ready")await start();
    if(state.status!=="ready")throw Error(state.error||"クラウドに接続できません");
    if(uploading)await uploading;
    uploading=(async()=>{
      const entries=await readIndex();
      if(!entries.some(e=>e.id===id))throw Error("削除対象が見つかりません");
      // 履歴から外してからファイルを削除。削除失敗時でも既存の他世代は維持。
      await commitIndex(entries.filter(e=>e.id!==id));
      await request(id,"DELETE");
      return true;
    })();
    try{return await uploading;}finally{uploading=null;scheduleAuto();}
  }
  root.addEventListener("qp:saved",event=>{
    if(!event.detail||typeof event.detail.json!=="string")return;
    latestSave={json:event.detail.json,savedAt:event.detail.savedAt};
    scheduleAuto();
  });
  root.document.addEventListener("visibilitychange",()=>{
    // 画面非表示で送信を強制しない。24時間以内の余分なアップロードを防止。
    if(!root.document.hidden)scheduleAuto();
  });
  root.addEventListener("online",()=>{
    retryAt=0;
    if(state.status==="error")start();
    else scheduleAuto();
  });
  root.addEventListener("load",()=>root.setTimeout(start,START_DELAY_MS));
  root.QPCloud={
    start,backupNow,autoBackup,listBackups,fetchCloudSave,deleteBackup,
    getState:()=>({...state}),
    subscribe(fn){listeners.add(fn);fn({...state});return ()=>listeners.delete(fn);}
  };
})(typeof globalThis!=="undefined"?globalThis:this);
