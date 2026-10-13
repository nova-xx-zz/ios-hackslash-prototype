// 試作用: OP種類ごとの重みとランク別効果上限。
// 現行 ITEM_OPTIONS の定義に近い規模で、種類別に倍率を調整する候補値。
// 本体ドロップ・戦闘計算・課金の正本には接続しない。
(function(root){
  "use strict";
  const RANKS=Object.freeze(["n","r","sr","ur","lr"]);
  const make=(label,weight,tiers,role)=>{
    const ranges={};
    RANKS.forEach((rank,i)=>{ranges[rank]=Object.freeze(tiers[i].slice());});
    return Object.freeze({label,weight,ranges:Object.freeze(ranges),role});
  };
  const CATALOG=Object.freeze({
    atk_pct: make("ATK上昇",200,[[.01,.03],[.03,.05],[.05,.08],[.08,.11],[.11,.15]],"攻撃特化"),
    mag_pct: make("MAG上昇",140,[[.01,.03],[.03,.05],[.05,.08],[.08,.11],[.11,.15]],"魔法特化"),
    crit: make("会心率",100,[[.005,.01],[.01,.015],[.015,.025],[.025,.035],[.035,.05]],"火力／物理"),
    guard: make("被ダメージ軽減",95,[[.005,.01],[.01,.02],[.02,.03],[.03,.04],[.04,.06]],"耐久"),
    lifesteal: make("HP吸収",75,[[.005,.01],[.01,.015],[.015,.02],[.02,.03],[.03,.04]],"継戦能力"),
    material: make("強化石獲得",150,[[.02,.04],[.04,.06],[.06,.09],[.09,.12],[.12,.18]],"周回効率"),
    exp: make("経験値獲得",100,[[.02,.04],[.04,.07],[.07,.10],[.10,.15],[.15,.20]],"育成"),
    heal: make("回復量",80,[[.03,.05],[.05,.08],[.08,.12],[.12,.16],[.16,.20]],"支援"),
    spd_pct: make("SPD上昇",60,[[.01,.02],[.02,.03],[.03,.04],[.04,.06],[.06,.08]],"行動速度")
  });
  const KEYS=Object.freeze(Object.keys(CATALOG));
  const TOTAL_WEIGHT=KEYS.reduce((sum,key)=>sum+CATALOG[key].weight,0);
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);

  // rng.float(0, sum) による出現重み抽選。最終フォールバックは浮動小数の丸め対策。
  function pickKind(rng){
    if(!rng||typeof rng.float!=="function")throw TypeError("RNG float is required");
    let roll=rng.float(0,TOTAL_WEIGHT);
    if(!Number.isFinite(roll)||roll<0||roll>=TOTAL_WEIGHT)throw RangeError("RNG returned out-of-range value");
    for(const key of KEYS){
      if(roll<CATALOG[key].weight)return key;
      roll-=CATALOG[key].weight;
    }
    return KEYS[KEYS.length-1];
  }
  function rangeFor(key,rank){
    if(!own(CATALOG,key)||!RANKS.includes(rank))throw RangeError("Invalid OP kind or rarity");
    return CATALOG[key].ranges[rank];
  }
  function valueFor(key,rank,rng){
    const [min,max]=rangeFor(key,rank);
    if(!rng||typeof rng.float!=="function")throw TypeError("RNG float is required");
    const result=rng.float(min,max);
    if(!Number.isFinite(result)||result<min||result>max)throw RangeError("Invalid OP value source");
    // 全て割合系の候補。0.1%刻みで表示しやすい形に量子化。
    const value=Math.round(result*1000)/1000;
    return Math.max(min,Math.min(max,value));
  }
  function chanceForKind(key){
    if(!own(CATALOG,key))throw RangeError("Invalid OP kind");
    return CATALOG[key].weight/TOTAL_WEIGHT;
  }
  const api={RANKS,CATALOG,KEYS,TOTAL_WEIGHT,pickKind,rangeFor,valueFor,chanceForKind};
  root.QPCore=root.QPCore||{};root.QPCore.optionBalanceTrial=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
