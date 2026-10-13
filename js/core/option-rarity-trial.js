// 試作専用：武器レア度と独立した天然OPランク抽選/周回試算。
// 実ドロップ・セーブ・課金には接続しない。数値はプレイテスト用の仮値。
(function (root) {
  "use strict";
  const Rank = (root.QPCore && root.QPCore.lootProtectionTrial) ||
    (typeof require === "function" ? require("./loot-protection-trial.js") : null);
  const RNG = (root.QPCore && root.QPCore.rng) ||
    (typeof require === "function" ? require("./rng.js") : null);
  const Balance = (root.QPCore && root.QPCore.optionBalanceTrial) ||
    (typeof require === "function" ? require("./option-balance-trial.js") : null);
  if (!Rank || !RNG || !Balance) throw Error("OP rarity trial requires loot protection, RNG and balance");

  const RANKS = Object.freeze(["n", "r", "sr", "ur", "lr"]);
  const WEAPON_WEIGHTS = Object.freeze({ n: 7100, r: 2200, sr: 650, ur: 35, lr: 15 });
  const MATERIAL_VALUES = Object.freeze({ n: 5, r: 20, sr: 80, ur: 350, lr: 1500 });
  // OP付与率とランク分布は仮説。normalは現行でOPなしだが試験上は10%案。
  // BP(10000分率)にすれば合計や丸め誤差をテストしやすい。
  const MODES = Object.freeze({
    normal: Object.freeze({label:"通常（候補）",optionChance:0.10,
      weights:Object.freeze({n:8000,r:1800,sr:180,ur:19,lr:1})}),
    hard: Object.freeze({label:"ハード（候補）",optionChance:1,
      weights:Object.freeze({n:6000,r:3000,sr:900,ur:95,lr:5})}),
    extra: Object.freeze({label:"エクストラ（候補）",optionChance:1,
      weights:Object.freeze({n:4500,r:3400,sr:1900,ur:180,lr:20})})
  });
  // 現行OPから機能例を選抜。属性反転・虚無は試作専用で実戦効果未実装。
  const BASIC_KEYS = Balance.KEYS;
  const SPECIAL_KEYS = Object.freeze({ur:"element_reverse_earth",lr:"void_resonance"});
  const SPECIAL_RATE = Object.freeze({ur:0.02,lr:0.10});

  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

  function pickWeighted(weights, rng) {
    const total=Object.values(weights).reduce((a,b)=>a+b,0);
    if (total<=0) throw RangeError("Weights must be positive");
    let roll=rng.float(0,total);
    for(const key of RANKS) {
      const w=weights[key]||0;
      if(roll<w)return key;
      roll-=w;
    }
    return RANKS[RANKS.length-1];
  }
  function optionForRank(rank,rng) {
    if(!RANKS.includes(rank))throw RangeError("Invalid OP rank");
    if(SPECIAL_KEYS[rank] && rng.chance(SPECIAL_RATE[rank]))
      return {key:SPECIAL_KEYS[rank],rank,value:1,origin:"natural",special:true};
    const key=Balance.pickKind(rng);
    const value=Balance.valueFor(key,rank,rng);
    return {key,rank,value,origin:"natural"};
  }
  function rollOne(mode,rng) {
    if(!own(MODES,mode))throw RangeError("Invalid trial loot mode");
    const weaponRarity=pickWeighted(WEAPON_WEIGHTS,rng);
    const opEnabled=rng.chance(MODES[mode].optionChance);
    const op=opEnabled?optionForRank(pickWeighted(MODES[mode].weights,rng),rng):null;
    return {rarity:weaponRarity,materialValue:MATERIAL_VALUES[weaponRarity],
      options:op?[op]:[]};
  }

  function probability(mode,weaponRarity,minRank) {
    if(!own(MODES,mode)||!own(WEAPON_WEIGHTS,weaponRarity)||!RANKS.includes(minRank))
      throw RangeError("Invalid probability inputs");
    const weapon=WEAPON_WEIGHTS[weaponRarity]/10000;
    const cfg=MODES[mode];
    const option=RANKS.slice(RANKS.indexOf(minRank))
      .reduce((total,rank)=>total+cfg.weights[rank],0)/10000;
    const perDrop=weapon*cfg.optionChance*option;
    // ドロップ約5個/周は企画上の概算。レア敵・宝箱を含む実測ではない。
    const perRun=1-Math.pow(1-perDrop,5);
    return {perDrop,perRun,expectedRuns:perRun>0?1/perRun:Infinity};
  }

  // 特定OPの1ドロップあたり入手確率。装備ランクが未指定なら武器レア度を問わない。
  // 特殊OPはUR/LRの特殊抽選からのみ発生し、通常OPの抽選重みには混ぜない。
  function probabilityForKind(mode,rank,key,weaponRarity) {
    if(!own(MODES,mode)||!RANKS.includes(rank)||
      (weaponRarity!==undefined&&!own(WEAPON_WEIGHTS,weaponRarity))) {
      throw RangeError("Invalid OP probability inputs");
    }
    const weaponFactor=weaponRarity===undefined?1:WEAPON_WEIGHTS[weaponRarity]/10000;
    const rankFactor=MODES[mode].weights[rank]/10000;
    let kindFactor;
    if(key===SPECIAL_KEYS[rank]) {
      kindFactor=SPECIAL_RATE[rank];
    }else if(Balance.CATALOG[key]) {
      kindFactor=(1-(SPECIAL_RATE[rank]||0))*Balance.chanceForKind(key);
    }else {
      throw RangeError("Invalid option kind for rank");
    }
    const perDrop=weaponFactor*MODES[mode].optionChance*rankFactor*kindFactor;
    const perRun=1-Math.pow(1-perDrop,5);
    return {perDrop,perRun,expectedRuns:perRun?1/perRun:Infinity};
  }

  function simulate(options) {
    const opts=options||{};
    const mode=opts.mode||"hard";
    const count=opts.count===undefined?1000:opts.count;
    const seed=opts.seed===undefined?20261014:opts.seed;
    const minRank=opts.minRank||"sr";
    if(!own(MODES,mode)||!RANKS.includes(minRank))throw RangeError("Invalid simulation settings");
    if(!Number.isInteger(count)||count<1||count>10000)throw RangeError("Simulation count must be 1..10000");
    if(!Number.isSafeInteger(seed))throw RangeError("Seed must be an integer");
    const rng=RNG.createRng(seed), rankCounts={n:0,r:0,sr:0,ur:0,lr:0};
    const kindCounts=Object.fromEntries(Balance.KEYS.map(k=>[k,0]));
    Object.values(SPECIAL_KEYS).forEach(k=>{kindCounts[k]=0;});
    const items=[],rareExamples=[];
    let withoutOption=0,nWithRare=0,nWithUR=0,withSpecial=0;
    for(let i=0;i<count;i++){
      const item=rollOne(mode,rng);
      const op=item.options[0];
      if(op){
        rankCounts[op.rank]++;
        kindCounts[op.key]++;
        if(op.special)withSpecial++;
        if(item.rarity==="n" && RANKS.indexOf(op.rank)>=2)nWithRare++;
        if(item.rarity==="n" && RANKS.indexOf(op.rank)>=3)nWithUR++;
        if(rareExamples.length<8 && RANKS.indexOf(op.rank)>=2) {
          rareExamples.push({weaponRank:item.rarity,optionRank:op.rank,key:op.key,
            value:op.value,special:op.special===true});
        }
      }else withoutOption++;
      items.push(item);
    }
    // 実装済みの試作保護判定で保持と素材減少も推計する。N/Rだけ分解対象。
    const result=Rank.simulate(items,{enabled:true,rarities:["n","r"],
      protectRareOptions:true,minRank});
    const withoutProtection=Rank.simulate(items,{enabled:true,rarities:["n","r"],
      protectRareOptions:false});
    return {
      mode,count,seed,minRank,rankCounts,kindCounts,withoutOption,
      nWithRare,nWithUR,withSpecial,rareExamples,
      kept:result.kept.length,disassembled:result.disassembled.length,
      protectedByOption:result.savedByOptions,
      materials:result.materials,materialsWithoutProtection:withoutProtection.materials
    };
  }
  const api={RANKS,WEAPON_WEIGHTS,MATERIAL_VALUES,MODES,BASIC_KEYS,SPECIAL_KEYS,SPECIAL_RATE,
    KIND_CATALOG:Balance.CATALOG,optionForRank,rollOne,probability,probabilityForKind,simulate};
  root.QPCore=root.QPCore||{};root.QPCore.optionRarityTrial=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
