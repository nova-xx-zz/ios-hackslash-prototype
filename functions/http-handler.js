// Bearer ID TokenとApp Checkを必須にした /v1 バックアップHTTP API。
"use strict";
const {ApiError}=require("./backup-core");
const MAX_REQUEST_BYTES=735*1024;
function createHttpHandler({service,verifyAppCheck,allowedOrigins,allowedAppIds}){
  if(!service||typeof verifyAppCheck!=="function"||!Array.isArray(allowedOrigins)||!Array.isArray(allowedAppIds))throw Error("Invalid HTTP config");
  const origins=new Set(allowedOrigins);
  const apps=new Set(allowedAppIds);
  return async (req,res)=>{
    const origin=req.headers.origin;
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Vary","Origin");
    const fail=(status,code)=>res.status(status).json({error:code});
    try{
      if(!origins.size||!apps.size)throw new ApiError(503,"server_not_configured");
      if(origin&&!origins.has(origin))throw new ApiError(403,"origin_forbidden");
      if(origin){res.setHeader("Access-Control-Allow-Origin",origin);}
      if(req.method==="OPTIONS"){
        if(!origin)throw new ApiError(403,"origin_required");
        res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type, X-Firebase-AppCheck");
        res.setHeader("Access-Control-Max-Age","600");
        return res.status(204).end();
      }
      const bearer=req.headers.authorization||"";
      if(!/^Bearer [^\s]+$/.test(bearer))throw new ApiError(401,"missing_auth");
      const token=bearer.slice(7);
      const appToken=req.headers["x-firebase-appcheck"];
      if(typeof appToken!=="string"||!appToken)throw new ApiError(401,"missing_app_check");
      let app;
      try{app=await verifyAppCheck(appToken);}catch{throw new ApiError(401,"invalid_app_check");}
      if(!apps.has(app?.appId))throw new ApiError(403,"unknown_app");
      const path=req.path.replace(/\/+$/,"");
      if(req.method==="GET"&&path==="/v1/account")return res.status(200).json(await service.getAccount(token));
      if(req.method==="GET"&&path==="/v1/progress/backup")return res.status(200).json(await service.getBackup(token));
      if(req.method==="POST"&&path==="/v1/progress/backup"){
        if(!req.is("application/json"))throw new ApiError(415,"json_required");
        if((req.rawBody?.length??0)>MAX_REQUEST_BYTES)throw new ApiError(413,"request_too_large");
        return res.status(200).json(await service.putBackup(token,req.body));
      }
      return fail(404,"not_found");
    }catch(error){
      return fail(error instanceof ApiError?error.status:500,error instanceof ApiError?error.code:"internal_error");
    }
  };
}
module.exports={createHttpHandler};
