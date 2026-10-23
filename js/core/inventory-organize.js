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
 // 明示的な拡張選択でもロック済みは対象にしない。未ロックの貴重品・呪い・UR/LR等は
 // UI側の確認操作を経て初めて一括分解できる。
 function isBulkSelectable(item,includeValuable,includeCursed){
   if(!item||item.locked)return false;
   // 旧2引数の互換は維持。UIは独立した2条件を明示する。
   if(includeCursed===undefined)includeCursed=includeValuable;
   if(item.cursed)return !!includeCursed;
   return !!includeValuable||isSafeBulkCandidate(item);
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
   if(!["rarity","power","materials"].includes(mode))throw new RangeError("Unknown inventory sort: "+mode);
   // 比較ごとに装備能力を再計算せず、各アイテムにつき一度だけ評価する。
   // 元配列・装備オブジェクトは変更しない。従来の並び順と安定性を維持する。
   const rarityIndex=new Map(rarities.map((r,i)=>[r.key,i]));
   const materialByRarity=new Map(rarities.map(r=>[r.key,r.material||0]));
   const metrics=items.map((item,index)=>{
     const value=score(item);
     return {
       item,index,
       rarity:rarityIndex.has(item.rarity)?rarityIndex.get(item.rarity):-1,
       power:Number.isFinite(value)?value:0,
       material:Number.isFinite(item.materialValue)?item.materialValue:(materialByRarity.get(item.rarity)||0),
       opCount:(Array.isArray(item.options)?item.options.length:0)+
         (Array.isArray(item.naturalOptions)?item.naturalOptions.length:0)
     };
   });
   metrics.sort((a,b)=>{
     const primary=mode==="power"?b.power-a.power:mode==="materials"?b.material-a.material:b.rarity-a.rarity;
     return primary||b.rarity-a.rarity||b.opCount-a.opCount||b.power-a.power||a.index-b.index;
   });
   return metrics.map(m=>m.item);
 }
 const api={BULK_RARITIES,VIEWS,isValuable,isSafeBulkCandidate,isBulkSelectable,matches,filter,sort};
 root.QPCore=root.QPCore||{};
 root.QPCore.inventoryOrganize=api;
 if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
