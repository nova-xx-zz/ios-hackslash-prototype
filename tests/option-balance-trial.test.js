"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Balance=require("../js/core/option-balance-trial.js");
const Trial=require("../js/core/option-rarity-trial.js");

const near=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,
  "expected "+b+", got "+a);

test("各OPは独立した重みとN～LR品質帯を持ち、重み合計は1000",()=>{
  assert.equal(Balance.TOTAL_WEIGHT,1000);
  assert.equal(Balance.KEYS.length,9);
  for(const key of Balance.KEYS){
    const def=Balance.CATALOG[key];
    assert.ok(def.label&&def.role);
    assert.ok(def.weight>0);
    let lastMin=-1,lastMax=-1;
    for(const rank of Balance.RANKS){
      const range=Balance.rangeFor(key,rank);
      assert.equal(range.length,2);
      assert.ok(range[0]>=0 && range[1]<=.20 && range[0]<=range[1]);
      assert.ok(range[0]>=lastMin && range[1]>=lastMax,"quality ranges must be monotonic: "+key+"/"+rank);
      lastMin=range[0];lastMax=range[1];
    }
  }
  assert.deepEqual(Trial.BASIC_KEYS,Balance.KEYS);
  near(Balance.KEYS.reduce((sum,key)=>sum+Balance.chanceForKind(key),0),1);
});

test("会心・吸収・被ダメ軽減にはATK/EXPと異なる上限を適用",()=>{
  near(Balance.rangeFor("atk_pct","lr")[1],.15);
  near(Balance.rangeFor("crit","lr")[1],.05);
  near(Balance.rangeFor("lifesteal","lr")[1],.04);
  near(Balance.rangeFor("guard","lr")[1],.06);
  near(Balance.rangeFor("material","lr")[1],.18);
  near(Balance.rangeFor("exp","lr")[1],.20);
  near(Balance.rangeFor("spd_pct","lr")[1],.08);
  assert.throws(()=>Balance.rangeFor("invalid","lr"),/Invalid/);
  assert.throws(()=>Balance.rangeFor("crit","unknown"),/Invalid/);
});

test("重み境界でOPの種類が確定し、旧来の等確率抽選から変わっている",()=>{
  function at(n){return Balance.pickKind({float:()=>n});}
  assert.equal(at(0),"atk_pct");
  assert.equal(at(199.999),"atk_pct");
  assert.equal(at(200),"mag_pct");
  assert.equal(at(340),"crit");
  assert.equal(at(440),"guard");
  assert.equal(at(535),"lifesteal");
  assert.equal(at(610),"material");
  assert.equal(at(760),"exp");
  assert.equal(at(860),"heal");
  assert.equal(at(940),"spd_pct");
  assert.equal(at(999.999),"spd_pct");
  assert.throws(()=>at(1000),/out-of-range/);
  assert.throws(()=>at(-1),/out-of-range/);
});

test("抽選したOPの数値は効果ごとの下限と上限を超えない",()=>{
  const sources=[{float:(a)=>a},{float:(a,b)=>(a+b)/2},{float:(a,b)=>b}];
  for(const key of Balance.KEYS){
    for(const rank of Balance.RANKS){
      const [min,max]=Balance.rangeFor(key,rank);
      for(const source of sources){
        const value=Balance.valueFor(key,rank,source);
        assert.ok(value>=min && value<=max,key+"/"+rank+"/"+value);
        assert.equal(Math.round(value*1000),value*1000,"values are quantized to 0.1%");
      }
    }
  }
});

test("特定OPの理論確率はランク付与率×種類の重み、特殊OPは別抽選",()=>{
  for(const mode of Object.keys(Trial.MODES)){
    for(const rank of Trial.RANKS){
      let sum=0;
      for(const key of Balance.KEYS){
        const p=Trial.probabilityForKind(mode,rank,key);
        sum+=p.perDrop;
        const n=Trial.probabilityForKind(mode,rank,key,"n");
        near(n.perDrop,p.perDrop*.71);
      }
      if(Trial.SPECIAL_KEYS[rank]){
        sum+=Trial.probabilityForKind(mode,rank,Trial.SPECIAL_KEYS[rank]).perDrop;
      }
      const expected=Trial.MODES[mode].optionChance*Trial.MODES[mode].weights[rank]/10000;
      near(sum,expected);
    }
  }
  near(Trial.probabilityForKind("extra","lr","crit","n").perDrop,
    .71*(20/10000)*.90*(100/1000));
  near(Trial.probabilityForKind("extra","lr","void_resonance","n").perDrop,
    .71*(20/10000)*.10);
  assert.throws(()=>Trial.probabilityForKind("hard","n","void_resonance"),/Invalid/);
  assert.throws(()=>Trial.probabilityForKind("hard","sr","missing"),/Invalid/);
  assert.throws(()=>Trial.probabilityForKind("hard","ur","crit","missing"),/Invalid/);
});

test("10,000件試行で重みの近似とランク別上限を満たし、同じシードは同じ結果",()=>{
  const report=Trial.simulate({mode:"extra",count:10000,seed:20261014});
  assert.equal(Object.values(report.kindCounts).reduce((a,b)=>a+b,0)+report.withoutOption,10000);
  assert.ok(report.kindCounts.atk_pct>report.kindCounts.crit);
  assert.ok(report.kindCounts.material>report.kindCounts.guard);
  assert.ok(report.withSpecial>=0);
  assert.ok(report.kindCounts.element_reverse_earth+report.kindCounts.void_resonance===report.withSpecial);
  assert.deepEqual(report,Trial.simulate({mode:"extra",count:10000,seed:20261014}));
  for(const e of report.rareExamples){
    if(e.special)assert.equal(e.value,1);
    else{
      const [min,max]=Balance.rangeFor(e.key,e.optionRank);
      assert.ok(e.value>=min && e.value<=max);
    }
  }
});
