"use strict";
// 現行ゲームデータから生成した実在のLv99ビルドに、候補のソフトキャップを比較適用する。
// 戦闘エンジン・実ドロップ・課金は変更しない。threshold/ceilingは調整用仮値。
const { loadGameData } = require("./load-data.js");
const Audit = require("./real-option-cap-audit.js");
const Stack = require("../../js/core/option-stack-trial.js");

function curve(threshold, ceiling) {
  if (!Number.isFinite(threshold) || !Number.isFinite(ceiling) ||
      threshold < 0 || ceiling <= threshold) throw RangeError("Invalid soft-cap curve");
  return Object.freeze({threshold, ceiling});
}
const CURVES = Object.freeze({
  conservative: Object.freeze({
    label:"ソフト案A（慎重）",
    critChance:curve(.75,.90),
    passiveLifesteal:curve(.30,.45),
    totalLifesteal:curve(.80,.92),
    damageReduction:curve(.60,.72),
    healBonus:curve(1.0,1.40),
    materialBonus:curve(.50,.80),
    expBonus:curve(.50,.80),
    mpReduction:curve(.60,.72)
  }),
  generous: Object.freeze({
    label:"ソフト案B（装備収集重視）",
    critChance:curve(.75,.97),
    passiveLifesteal:curve(.30,.60),
    totalLifesteal:curve(.80,.99),
    damageReduction:curve(.60,.82),
    healBonus:curve(1.0,1.80),
    materialBonus:curve(.50,1.20),
    expBonus:curve(.50,1.20),
    mpReduction:curve(.60,.85)
  })
});
const POLICIES=Object.freeze(["hard","conservative","generous"]);

// 閾値までは元値を保ち、超過後は「天井に近づくが達しない」滑らかな逓減曲線。
// 増加するOPの効果を突然ゼロにしない。負の軽減（被ダメ増加など）はそのまま保つ。
function soften(value, threshold, ceiling) {
  if (!Number.isFinite(value)) throw RangeError("Non-finite effect");
  if (!Number.isFinite(threshold)||!Number.isFinite(ceiling)||
      threshold<0||ceiling<=threshold) throw RangeError("Invalid soft cap limits");
  if (value<=threshold) return value;
  const span=ceiling-threshold;
  return threshold-span*Math.expm1(-(value-threshold)/span);
}
function applyPolicy(stack, policy) {
  if (!POLICIES.includes(policy))throw RangeError("Unknown soft cap policy");
  if (!stack||!stack.raw||!stack.effective||typeof stack.abilityLifesteal!=="number")
    throw TypeError("Expected a stack computation");
  if (policy==="hard")return {...stack.effective};
  const cfg=CURVES[policy];
  const apply=(key,v)=>soften(v,cfg[key].threshold,cfg[key].ceiling);
  const effective={
    critChance:apply("critChance",stack.raw.critChance),
    passiveLifesteal:apply("passiveLifesteal",stack.raw.passiveLifesteal),
    // 既存の技固有吸収率はパッシブ上限でカットしない。合算後の上限は別管理。
    totalLifesteal:apply("totalLifesteal",
      apply("passiveLifesteal",stack.raw.passiveLifesteal)+stack.abilityLifesteal),
    damageReduction:apply("damageReduction",stack.raw.damageReduction),
    healBonus:apply("healBonus",stack.raw.healBonus),
    materialBonus:apply("materialBonus",stack.raw.materialBonus),
    expBonus:apply("expBonus",stack.raw.expBonus),
    mpReduction:apply("mpReduction",stack.raw.mpReduction)
  };
  return effective;
}
function compare(data=loadGameData()) {
  const cases=Audit.audit(data);
  return cases.map(({build,cases:rows})=>{
    const focus=rows[0].focus;
    const options=rows.map(row=>{
      const stack=Stack.compute({sources:row.sources,abilityLifesteal:row.abilityLifesteal});
      return {
        optionCount:row.optionCount,
        raw:row.raw,
        hard:applyPolicy(stack,"hard")[focus],
        conservative:applyPolicy(stack,"conservative")[focus],
        generous:applyPolicy(stack,"generous")[focus],
        sp:row.usedSP,
        skillAbsorption:row.abilityLifesteal
      };
    });
    const baseline=options[0],two=options[1],six=options[2];
    const deltaRaw=six.raw-two.raw;
    const gain={},baselineLoss={};
    for(const policy of POLICIES) {
      const increase=six[policy]-two[policy];
      gain[policy]={
        from2To6:increase,
        retention:deltaRaw>0?increase/deltaRaw:null
      };
      baselineLoss[policy]=baseline.raw-baseline[policy];
    }
    return {
      build,name:rows[0].name,job:rows[0].job,jobName:rows[0].jobName,
      race:rows[0].race,series:rows[0].series,focus,
      sp:rows[0].usedSP, ability:rows[0].abilityId||null,
      options,gain,baselineLoss
    };
  });
}
module.exports={CURVES,POLICIES,soften,applyPolicy,compare};
