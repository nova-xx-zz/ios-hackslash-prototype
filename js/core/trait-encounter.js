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

/**
 * Before enemy instances are created, cap the number of native trait enemies
 * without erasing any species' native resistances. Protected rares remain
 * intact; excess ordinary innate-trait species are replaced with a randomly
 * selected non-trait species from the *same dungeon pool*.
 *
 * A pool without a safe replacement fails loudly instead of silently changing
 * boss/rare rules or allowing a >3 native-trait pack.
 */
function capNativeTraitRoles(roles, pool, getTraits, rng, maxTraits=3){
 if(!Array.isArray(roles)||roles.length<1||roles.length>5||
    !Array.isArray(pool)||!pool.length||typeof getTraits!=="function"||
    !rng||typeof rng.int!=="function"||!Number.isInteger(maxTraits)||
    maxTraits<1||maxTraits>3)throw new RangeError("invalid native trait cap input");
 function hasTraits(key){
   const traits=getTraits(key);
   if(!Array.isArray(traits))throw new TypeError("invalid native traits");
   return traits.length>0;
 }
 const result=roles.map(role=>{
   if(!role||typeof role.key!=="string")throw new TypeError("invalid enemy role");
   return {...role};
 });
 const native=result.map((role,index)=>({role,index}))
   .filter(({role})=>!role.isBoss&&hasTraits(role.key));
 const excess=native.length-maxTraits;
 if(excess<=0)return result;
 const replaceable=native.filter(({role})=>!role.isRare).map(({index})=>index);
 const ordinaryPool=pool.filter(key=>typeof key==="string"&&!hasTraits(key));
 if(replaceable.length<excess||ordinaryPool.length===0)
   throw new RangeError("cannot cap native trait enemies without altering protected species");
 for(let i=0;i<excess;i++){
   const pick=rng.int(replaceable.length);
   if(!Number.isInteger(pick)||pick<0||pick>=replaceable.length)
     throw new RangeError("invalid native trait selection");
   const [index]=replaceable.splice(pick,1);
   const replacement=rng.int(ordinaryPool.length);
   if(!Number.isInteger(replacement)||replacement<0||replacement>=ordinaryPool.length)
     throw new RangeError("invalid ordinary enemy selection");
   result[index].key=ordinaryPool[replacement];
 }
 return result;
}
module.exports={TRAIT_TYPES,rollTraitAssignments,capNativeTraitRoles};
