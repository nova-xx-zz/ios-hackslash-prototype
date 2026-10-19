"use strict";
// 1～3体の特性敵をランダム配置する試験用の純粋な抽選器。
// 戦闘ごとの敵総数1～5を超えず、ボス・レア・元々の特性敵を変更しない。
// 属性・特性の倍率はここでは計算せず、本体makeEnemyから借りる。
const TRAIT_TYPES=Object.freeze(["spirit","ward","armored","undead"]);

function rollTraitAssignments(enemies,rng,allowed=TRAIT_TYPES){
 if(!Array.isArray(enemies)||enemies.length<1||enemies.length>5||
   !rng||typeof rng.int!=="function"||!Array.isArray(allowed)||!allowed.length||
   allowed.some(x=>!TRAIT_TYPES.includes(x)))throw new RangeError("invalid trait encounter input");
 const nativeCount=enemies.filter(e=>e&&!e.isBoss&&Array.isArray(e.traits)&&e.traits.length>0).length;
 const eligible=enemies.map((e,i)=>({e,i}))
   .filter(({e})=>e&&!e.isBoss&&!e.isRare&&(!Array.isArray(e.traits)||e.traits.length===0))
   .map(x=>x.i);
 // If every enemy is naturally a trait enemy, a boss or a rare,
 // add no trait (never strip native tags or change bosses).
 if(!eligible.length)return [];
 const desired=1+rng.int(3); // 1～3 equally weighted
 if(!Number.isInteger(desired)||desired<1||desired>3)throw new RangeError("invalid desired count");
 // The target is TOTAL ordinary trait enemies, including existing innate
 // traits. Do not remove original traits if they exceed 3 in a rare random pack.
 const count=Math.max(0,Math.min(desired-nativeCount,eligible.length));
 const remaining=eligible.slice();
 const result=[];
 for(let k=0;k<count;k++){
   const n=rng.int(remaining.length);
   if(!Number.isInteger(n)||n<0||n>=remaining.length)throw new RangeError("invalid target index");
   const [enemyIndex]=remaining.splice(n,1);
   const t=rng.int(allowed.length);
   if(!Number.isInteger(t)||t<0||t>=allowed.length)throw new RangeError("invalid trait index");
   result.push({index:enemyIndex,trait:allowed[t]});
 }
 return result;
}
module.exports={TRAIT_TYPES,rollTraitAssignments};
