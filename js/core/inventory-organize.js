// 所持品の表示・安全な一括選択条件。手動の個別分解は従来の確認操作を維持する。
(function(root){
 "use strict";
 const rewards=(root.QPCore&&root.QPCore.rewards)||(typeof require==="function"?require("./rewards.js"):null);
 const BULK_RARITIES=Object.freeze(["n","r","sr"]);
 const VIEWS=Object.freeze(["all","valuable","safe","locked"]);
 function isValuable(item){
   return !!item && (!!item.locked||!!item.unique||!!item.cursed||(item.plus||0)>0||
     rewards.hasProtectedOption(item)||item.rarity==="ur"||item.rarity==="lr");
 }
 function isSafeBulkCandidate(item){
   return !!item && BULK_RARITIES.includes(item.rarity) && !isValuable(item);
 }
 function matches(item,view){
   if(view==="all")return true;
   if(view==="valuable")return isValuable(item);
   if(view==="safe")return isSafeBulkCandidate(item);
   if(view==="locked")return !!item.locked;
   throw new RangeError("Unknown inventory view: "+view);
 }
 function filter(items,slot,view){
   return items.filter(item=>(slot==="all"||item.slot===slot)&&matches(item,view));
 }
 function sort(items,rarities,mode,score){
   const rank=item=>rarities.findIndex(r=>r.key===item.rarity);
   const value=item=>Number.isFinite(score(item))?score(item):0;
   const amount=item=>Number.isFinite(item.materialValue)?item.materialValue:
     (rarities.find(r=>r.key===item.rarity)||{}).material||0;
   const opCount=item=>(Array.isArray(item.options)?item.options.length:0)+
     (Array.isArray(item.naturalOptions)?item.naturalOptions.length:0);
   if(!["rarity","power","materials"].includes(mode))throw new RangeError("Unknown inventory sort: "+mode);
   return items.slice().sort((a,b)=>{
     const primary=mode==="power"?value(b)-value(a):mode==="materials"?amount(b)-amount(a):rank(b)-rank(a);
     return primary||rank(b)-rank(a)||opCount(b)-opCount(a)||value(b)-value(a);
   });
 }
 const api={BULK_RARITIES,VIEWS,isValuable,isSafeBulkCandidate,matches,filter,sort};
 root.QPCore=root.QPCore||{};
 root.QPCore.inventoryOrganize=api;
 if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
