// Universal anti-resistance accessory engraving — isolated combat study.
// This module is NOT loaded from index.html, game.js, save, rewards or shop.
// It supplies only an optional injected ability for battle-core simulations.
// Normal (non-Hard) guaranteed acquisition/crafting is a DESIGN PROPOSAL;
// there is no live player acquisition or attachment system yet.
"use strict";

const SLOTS=Object.freeze(["acc1","acc2","acc3"]);
const ENGRAVINGS=Object.freeze({
  arcane:Object.freeze({
    id:"arcane",name:"魔導の刻印",ability:"刻印術式",kind:"magic",element:null,
    ratio:0.45,desc:"物理主体の職も低威力の魔法ダメージを使用できる（霊体対策）",
  }),
  force:Object.freeze({
    id:"force",name:"武芸の刻印",ability:"刻印打撃",kind:"physical",element:null,
    ratio:0.45,desc:"魔法主体の職も低威力の物理ダメージを使用できる（魔法耐性対策）",
  }),
  holy:Object.freeze({
    id:"holy",name:"聖紋の刻印",ability:"刻印聖撃",kind:"physical",element:"holy",
    ratio:0.40,desc:"全職が聖属性の物理ダメージを使用できる（アンデッド対策）。霊体の物理無効は突破しない",
  }),
  sanctify:Object.freeze({
    id:"sanctify",name:"浄魔の刻印",ability:"刻印浄光",kind:"magic",element:"holy",
    ratio:0.30,desc:"霊体+アンデッドへの最後の対抗策。魔法+聖属性なので通常の魔導刻印より低威力",
  }),
});

/**
 * A mock Normal-accessible accessory holds ONE engraving. Each occupied
 * accessory slot may grant one ability; a second copy of the same type grants
 * no extra uses or stat bonuses. Ignores inactive/non-accessory slots.
 * Attack kind and element are deliberately independent so that holy physical
 * damage does not bypass immunity to physical attacks.
 *
 * Because the current battle API reads MAG for magic and ATK for physical,
 * the power is calibrated once from the character's current equipment stats:
 * expected base output ~= ratio * max(ATK,MAG), before enemy defense.
 * That enables low-stat classes to deal SOME damage without rewriting battle.js.
 * Resolved stats must be refreshed when level/gear changes in eventual live UI.
 */
function trialInscriptionAbilities(equip,stats){
 if(!equip||typeof equip!=="object")return [];
 if(!stats||!Number.isFinite(stats.atk)||!Number.isFinite(stats.mag)||
   stats.atk<0||stats.mag<0)throw new TypeError("valid ATK/MAG required");
 const dominant=Math.max(1,stats.atk,stats.mag),seen=new Set(),abilities=[];
 for(const slot of SLOTS){
   const item=equip[slot];
   if(!item||!item.trialInscription)continue;
   if(item.slot!=="accessory")throw new TypeError("inscription must be on an accessory");
   if(typeof item.trialInscription!=="string"||
     !Object.prototype.hasOwnProperty.call(ENGRAVINGS,item.trialInscription))
     throw new RangeError("unknown trial engraving");
   const def=ENGRAVINGS[item.trialInscription];
   if(seen.has(def.id))continue;
   seen.add(def.id);
   const base=def.kind==="magic"?Math.max(1,stats.mag):Math.max(1,stats.atk);
   const power=Math.round(dominant*def.ratio/base*10000)/10000;
   const ability={
      id:"trial_inscription_"+def.id,name:def.ability,kind:def.kind,
      target:"single",hits:1,mpCost:0,reqLevel:1,power,
      desc:def.desc,
   };
   if(def.element)ability.element=def.element;
   abilities.push(ability);
 }
 return abilities;
}
module.exports={SLOTS,ENGRAVINGS,trialInscriptionAbilities};
