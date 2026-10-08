// Production専用。Previewの匿名saves/{uid}には接続しない。
"use strict";
const {onRequest}=require("firebase-functions/v2/https");
const {initializeApp,getApps}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getAppCheck}=require("firebase-admin/app-check");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {createBackupService}=require("./backup-core");
const {createFirestoreRepository}=require("./firestore-repository");
const {createHttpHandler}=require("./http-handler");
if(!getApps().length)initializeApp();
const db=getFirestore();
const service=createBackupService({
  verifyToken:token=>getAuth().verifyIdToken(token,true),
  repository:createFirestoreRepository(db,()=>FieldValue.serverTimestamp()),
});
// 本番には検証済みの独立プロジェクト・CORS・App CheckアプリのAllowlistを要求。
// 例: SWORD_CREST_ALLOWED_ORIGINS=https://play.example.jp
//     SWORD_CREST_APP_CHECK_APP_IDS=1:123:web:... (Firebase App ID)
const allowedOrigins=(process.env.SWORD_CREST_ALLOWED_ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean);
const allowedAppIds=(process.env.SWORD_CREST_APP_CHECK_APP_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
const handler=createHttpHandler({
  service,
  verifyAppCheck:token=>getAppCheck().verifyToken(token),
  allowedOrigins,allowedAppIds,
});
exports.swordcrestApi=onRequest({
  region:"asia-northeast1",cors:false,timeoutSeconds:30,maxInstances:5,concurrency:10,
  memory:"256MiB",minInstances:0
},(req,res)=>{
  if(process.env.GCLOUD_PROJECT==="sword-crest-jp")return res.status(503).json({error:"preview_project_forbidden"});
  return handler(req,res);
});
