// 鍛冶屋 > 試作工房。試遊用データのみ使用し、実プレイの装備・セーブ・課金を変更しない。
"use strict";
const ForgeTrial = QPCore.forgeGearTrial;
const LootTrial = QPCore.lootProtectionTrial;
const RarityTrial = QPCore.optionRarityTrial;
const FORGE_TRIAL_KEY = "swordcrest_forge_gear_trial_v2";
const FORGE_TRIAL_LEGACY_KEY = "swordcrest_forge_trial_v1";
let forgeTrialEnemyElement = "earth";
let forgeTrialRareProtection = true;
let forgeTrialProtectRank = "sr";
let forgeTrialLootMode = "hard";
let forgeTrialLootReport = null;
let forgeTrialFocusKind = "crit";
let forgeTrialFocusRank = "sr";
let forgeTrialState = null;
let forgeTrialTarget = "sr";
let forgeTrialEssenceId = null;
let forgeTrialMessage = "強化 → 穴あけ → 天然OP抽出 → 継承の順に操作できます。";
let forgeTrialWarning = false;

function forgeTrialLoad() {
  if (forgeTrialState) return;
  try {
    const raw = localStorage.getItem(FORGE_TRIAL_KEY);
    if (raw && raw.length < 100000) {
      const saved = JSON.parse(raw);
      if (ForgeTrial.isValid(saved)) forgeTrialState = saved;
      else {
        forgeTrialMessage = "新しい試作保存データが不正なため、試作工房だけ初期化しました。";
        forgeTrialWarning = true;
      }
    } else if (!raw) {
      const old = localStorage.getItem(FORGE_TRIAL_LEGACY_KEY);
      if (old && old.length < 100000) {
        forgeTrialState = ForgeTrial.upgradeFromV1(JSON.parse(old));
        if (forgeTrialState) {
          forgeTrialMessage = "以前の試作工房の武器・穴・抽出液・天井を引き継ぎました。";
          forgeTrialWarning = false;
        }
      }
    }
  } catch (_) {
    forgeTrialMessage = "試作データを復元できなかったため、試作工房だけ初期化しました。";
    forgeTrialWarning = true;
  }
  if (!forgeTrialState) forgeTrialState = ForgeTrial.createDemo();
  forgeTrialSave();
}
function forgeTrialSave() {
  try { localStorage.setItem(FORGE_TRIAL_KEY, JSON.stringify(forgeTrialState)); }
  catch (_) { forgeTrialMessage += "（試作データを端末に保存できませんでした）"; }
}
function forgeOptionLabel(o) {
  if (!o || !ForgeTrial.OP_DEFS[o.key]) return "不明なOP";
  if (["atk","crit","guard"].includes(o.key)) {
    const label={atk:"ATK +",crit:"会心率 +",guard:"被ダメージ -"}[o.key];
    return label+(o.value*100).toFixed(o.value*100%1?1:0)+"%";
  }
  return ForgeTrial.OP_DEFS[o.key].label;
}
function forgeSelect(label,selected,onChange) {
  const select=forgeEl("select","forge-trial-select");
  select.setAttribute("aria-label",label);
  Object.entries(ForgeTrial.ELEMENTS).forEach(function(entry){
    const option=forgeEl("option","",entry[1]);option.value=entry[0];
    option.selected=entry[0]===selected;
    select.appendChild(option);
  });
  select.addEventListener("change",function(){onChange(select.value)});
  return select;
}
function forgeEl(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = String(content);
  return el;
}
function forgeButton(text, action, disabled, className) {
  const button = forgeEl("button", className || "btn small ghost", text);
  button.type = "button";
  button.disabled = !!disabled;
  button.addEventListener("click", action);
  return button;
}
function forgeSection(body, title, subtitle) {
  const section = forgeEl("section", "forge-trial-section");
  section.appendChild(forgeEl("h3", "", title));
  if (subtitle) section.appendChild(forgeEl("p", "forge-trial-note", subtitle));
  body.appendChild(section);
  return section;
}
function forgeApply(action) {
  const result = action();
  forgeTrialMessage = result.message || (result.ok ? "完了しました" : "操作できません");
  forgeTrialWarning = !result.ok;
  if (result.ok) forgeTrialSave();
  forgeTrialRender();
}
function openForgeTrial() {
  forgeTrialLoad();
  forgeTrialRender();
  showScreen("screen-forge-trial");
}
function forgeTrialRender() {
  forgeTrialLoad();
  const body = document.getElementById("forgeTrialBody");
  const previousScroll = body.scrollTop;
  body.replaceChildren();
  const state = forgeTrialState;
  let target = state.targets.find(function (t) { return t.id === forgeTrialTarget; });
  if (!target) { forgeTrialTarget = "sr"; target = state.targets.find(function (t) { return t.id === forgeTrialTarget; }); }
  if (!target) return;

  const intro = forgeEl("p", "forge-trial-note", "検証専用のサンプル武器を使用します。ゲーム本体の所持品・強化石・課金情報には一切反映されません。強化値と穴あけ素材は試作のため省略しています。");
  body.appendChild(intro);
  const msg = forgeEl("p", "forge-trial-message" + (forgeTrialWarning ? " warn" : ""), forgeTrialMessage);
  msg.setAttribute("role", "status");
  body.appendChild(msg);

  const choose = forgeSection(body, "① 継承先を選ぶ", "下位レアリティの天然OP抽出液だけを上位武器に継承できます。");
  const tabs = forgeEl("div", "forge-trial-tabs");
  state.targets.forEach(function (t) {
    tabs.appendChild(forgeButton(t.rarity.toUpperCase(), function () {
      forgeTrialTarget = t.id;
      forgeTrialEssenceId = null;
      forgeTrialMessage = t.name + "を選びました";
      forgeTrialWarning = false;
      forgeTrialRender();
    }, false, "forge-trial-chip" + (target.id === t.id ? " selected" : "")));
  });
  choose.appendChild(tabs);
  choose.appendChild(forgeEl("div", "forge-trial-weapon", target.name + " +" + target.plus));
  const summary=ForgeTrial.inspect(target);
  choose.appendChild(forgeEl("p","forge-trial-note","天然OP "+summary.naturalCount+" / 継承OP "+summary.inheritedCount+" / 合計 "+summary.total+" / 上限 "+summary.maxTotal));
  choose.appendChild(forgeEl("p", "forge-trial-note", "解放した穴 " + target.opened + " / " + ForgeTrial.SLOT_LEVELS[target.rarity].length +
    "　継承可能な空き穴 " + summary.freeInheritedSockets + "（総上限も適用）"));
  const slotRow = forgeEl("div", "forge-trial-slots");
  const allOps=[...target.naturalOptions,...target.options];
  ForgeTrial.SLOT_LEVELS[target.rarity].forEach(function (threshold, idx) {
    const op=allOps[idx];
    const label=op ? (op.origin==="natural"?"天然 ":"継承 ")+forgeOptionLabel(op) :
      idx < target.naturalOptions.length + target.opened ? "空き枠" : "+" + threshold + "で穴あけ";
    slotRow.appendChild(forgeEl("div", "forge-trial-slot" + (op ? " filled" : ""),
      "OP"+(idx + 1)+"　"+label));
  });
  choose.appendChild(slotRow);
  if (target.naturalOptions.length) {
    const natural=target.naturalOptions[0];
    choose.appendChild(forgeButton("天然OPを抽出："+forgeOptionLabel(natural),function(){
      if(!window.confirm("選んだ天然OPは武器から消え、抽出液になります。武器は残ります。実行しますか？"))return;
      forgeApply(function(){return ForgeTrial.extractTarget(state,target.id,0)});
    },false,"btn ghost forge-trial-wide"));
  }

  const growth = forgeSection(body, "② 強化と穴あけ", "強化値だけでは穴は開きません。条件を満たしてから穴あけを実行します。");
  const growthActions = forgeEl("div", "forge-trial-actions");
  ForgeTrial.SLOT_LEVELS[target.rarity].forEach(function (milestone) {
    growthActions.appendChild(forgeButton("試験強化 +" + milestone, function () {
      forgeApply(function () { return ForgeTrial.enhance(state, target.id, milestone); });
    }, target.plus >= milestone));
  });
  growth.appendChild(growthActions);
  const nextThreshold = ForgeTrial.SLOT_LEVELS[target.rarity][target.opened];
  growth.appendChild(forgeButton(nextThreshold === undefined ? "穴あけ完了" :
      "枠" + (target.opened + 1) + "を穴あけ（必要 +" + nextThreshold + "）",
    function () { forgeApply(function () { return ForgeTrial.openSocket(state, target.id); }); },
    !summary.canOpenNext, "btn primary forge-trial-wide"));
  if (nextThreshold !== undefined && !summary.canOpenNext) {
    const reason = target.plus < nextThreshold
      ? "まず試験強化で+" + nextThreshold + "にしてください。"
      : summary.freeTotal === 0
        ? "天然OPと継承OPを合わせて上限" + summary.maxTotal + "個です。天然OPを抽出すると、追加の穴あけができます。"
        : "穴あけ条件を満たしていません。";
    growth.appendChild(forgeEl("p", "forge-trial-note", reason));
  }

  const extracts = forgeSection(body, "③ 天然OPを抽出", "武器本体は残り、天然OPだけが消えます。継承済みOPは再抽出できません。");
  const availableSources = state.sources.filter(function (w) { return w.natural && !!ForgeTrial.OP_DEFS[w.optionKey]; });
  const extractedCount = state.sources.length - availableSources.length;
  extracts.appendChild(forgeEl("p", "forge-trial-note", "天然OPあり " + availableSources.length + "本 ／ 抽出済み武器 " + extractedCount + "本（武器本体は試作所持品に残っています）"));
  availableSources.forEach(function (weapon) {
    const div = forgeEl("div", "forge-trial-line");
    const opt = ForgeTrial.OP_DEFS[weapon.optionKey];
    const summary = opt ? weapon.name + "　／　" + forgeOptionLabel({key:weapon.optionKey,value:weapon.optionValue}) + "（OP " + opt.rarity.toUpperCase() + "）"
      : weapon.name + "　／　抽出済み";
    div.appendChild(forgeEl("div", "forge-trial-source-label", summary));
    div.appendChild(forgeButton(opt ? "抽出する" : "抽出済み", function () {
      forgeApply(function () { return ForgeTrial.extractSource(state, weapon.id); });
    }, !opt));
    extracts.appendChild(div);
  });
  extracts.appendChild(forgeButton("試遊用の天然OP武器を再補充", function () {
    forgeApply(function () { return ForgeTrial.addSamples(state); });
  }, state.sources.length + 5 > 55, "btn ghost forge-trial-wide"));

  const liquids = forgeSection(body, "④ 抽出液を選んで継承", "OPのランクで抽出液の個数が変わります。1回の継承で束ごと消費し、分割・複製はできません。");
  if (!state.essences.length) liquids.appendChild(forgeEl("p", "forge-trial-note", "抽出液がありません。先に天然OPを抽出してください。"));
  if (!state.essences.some(function (e) { return e.id === forgeTrialEssenceId; })) {
    const usable = state.essences.find(function (e) { return ForgeTrial.validate(state, target.id, e.id, false).ok; });
    forgeTrialEssenceId = usable ? usable.id : (state.essences[0] ? state.essences[0].id : null);
  }
  state.essences.forEach(function (e) {
    const op = ForgeTrial.OP_DEFS[e.key];
    if (!op) return;
    const btn = forgeButton(forgeOptionLabel(e) + "　×" + e.count + "（元 " + e.sourceRarity.toUpperCase() + "）", function () {
      forgeTrialEssenceId = e.id;
      forgeTrialRender();
    }, false, "forge-trial-essence" + (forgeTrialEssenceId === e.id ? " selected" : ""));
    liquids.appendChild(btn);
  });
  const choice = forgeTrialEssenceId;
  const canTry = choice ? ForgeTrial.validate(state, target.id, choice, false) : { ok: false, message: "抽出液を選んでください" };
  if (choice && !canTry.ok) liquids.appendChild(forgeEl("p", "forge-trial-note forge-trial-error", canTry.message));
  const maxFails = ForgeTrial.PITY_LIMIT[target.rarity];
  const isPity = maxFails !== undefined && target.failures >= maxFails;
  const pct = isPity ? 100 : Math.round(ForgeTrial.RATES[target.rarity] * 100);
  liquids.appendChild(forgeEl("p", "forge-trial-rate", "通常継承成功率 " + pct + "%" +
    (maxFails === undefined ? "（確定）" : "　／　天井 " + target.failures + "/" + maxFails + "回失敗" +
      (isPity ? "・次回確定" : ""))));
  const row = forgeEl("div", "forge-trial-actions");
  row.appendChild(forgeButton("通常継承", function () {
    if (!window.confirm("抽出液が成功・失敗どちらでも消費されます。通常継承を実行しますか？")) return;
    forgeApply(function () { return ForgeTrial.inherit(state, target.id, forgeTrialEssenceId, false); });
  }, !canTry.ok, "btn primary"));
  row.appendChild(forgeButton("確定継承液 ×1", function () {
    if (!window.confirm("試遊用確定液1個と抽出液を消費します。確定継承しますか？")) return;
    forgeApply(function () { return ForgeTrial.inherit(state, target.id, forgeTrialEssenceId, true); });
  }, !canTry.ok || state.trialLiquid < 1 || (target.rarity !== "ur" && target.rarity !== "lr") || isPity, "btn ghost"));
  liquids.appendChild(row);
  liquids.appendChild(forgeEl("p", "forge-trial-note", "テスト用確定継承液 " + state.trialLiquid + "個（実際の購入なし）"));
  liquids.appendChild(forgeEl("p", "forge-trial-message" + (forgeTrialWarning ? " warn" : ""), forgeTrialMessage));
  liquids.appendChild(forgeButton("確定継承液をテスト配布 +1", function () {
    forgeApply(function () {
      if (state.trialLiquid >= 20) return { ok: false, message: "テスト配布は20個までです" };
      state.trialLiquid += 1;
      return { ok: true, message: "テスト用確定継承液を1個配布しました。課金は発生しません" };
    });
  }, state.trialLiquid >= 20, "btn ghost forge-trial-wide"));

  const elementSec=forgeSection(body,"⑤ 属性相性を体感","試遊武器の属性と仮想敵の属性を切り替え、通常/虚無抑制/虚無無効の倍率を比較します。戦闘ダメージには未反映です。");
  const elementRows=forgeEl("div","forge-trial-element-rows");
  const weaponElement=forgeEl("label","forge-trial-note","試作武器の攻撃属性");
  weaponElement.appendChild(forgeSelect("武器の攻撃属性",target.attackElement,function(value){
    forgeApply(function(){return ForgeTrial.setElement(state,target.id,value)});
  }));
  elementRows.appendChild(weaponElement);
  const enemyElement=forgeEl("label","forge-trial-note","仮想敵の属性");
  enemyElement.appendChild(forgeSelect("敵の属性",forgeTrialEnemyElement,function(value){
    forgeTrialEnemyElement=value;
    forgeTrialRender();
  }));
  elementRows.appendChild(enemyElement);
  elementSec.appendChild(elementRows);
  ForgeTrial.compare(state,target.id,forgeTrialEnemyElement).forEach(function(result){
    const text=result.multiplier.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
    elementSec.appendChild(forgeEl("div","forge-trial-slot"+(result.immune?" forge-trial-error":""),
      result.label+"：×"+text+(result.immune?"（完全無効）":result.reversed?"（属性反転）":"")));
  });
  elementSec.appendChild(forgeEl("p","forge-trial-note","属性倍率のみの比較です。OPの攻撃力・会心などの実戦効果はまだ計算に含みません。"));
  const lootSection = forgeSection(body, "⑥ 装備収集と自動分解の保護テスト",
    "N/R装備でも希少な天然OPが付いていれば保護する想定です。下の8個は固定の試遊サンプルで、実際の所持品やドロップ率は変更しません。");
  const protectionButtons = forgeEl("div", "forge-trial-actions");
  protectionButtons.appendChild(forgeButton("希少OPの保護 " + (forgeTrialRareProtection ? "ON" : "OFF"),function(){
    forgeTrialRareProtection = !forgeTrialRareProtection;
    forgeTrialLootReport = null;
    forgeTrialRender();
  }, false, "btn ghost"));
  protectionButtons.appendChild(forgeButton("保護基準 " + forgeTrialProtectRank.toUpperCase() + "以上",function(){
    forgeTrialProtectRank = forgeTrialProtectRank === "sr" ? "ur" : "sr";
    forgeTrialLootReport = null;
    forgeTrialRender();
  }, !forgeTrialRareProtection, "btn ghost"));
  lootSection.appendChild(protectionButtons);
  const preview = LootTrial.simulate(LootTrial.sampleLoot(),{
    enabled:true, rarities:new Set(["n","r"]),
    protectRareOptions:forgeTrialRareProtection,minRank:forgeTrialProtectRank
  });
  lootSection.appendChild(forgeEl("p","forge-trial-rate",
    "保持 "+preview.kept.length+"個 / 分解 "+preview.disassembled.length+"個 / 強化石 "+preview.materials+"個 / OP保護 "+preview.savedByOptions+"個"));
  const why = {
    disabled:"自動分解OFF",rarity_excluded:"分解対象外のレア度",unique:"固有装備",
    locked:"ロック済み",inherited_option:"継承済みOP",special_option:"特殊OP",
    rare_option:"希少OP",unknown_option_rank:"不明なOPランク",unknown_option:"未解析OP",
    disassemble:"低レア自動分解"
  };
  preview.rows.forEach(function(row){
    const ops = Array.isArray(row.item.options) ? row.item.options : [];
    const rank = ops.map(o=>o.rank?o.rank.toUpperCase():"未設定").join("・") || "OPなし";
    const verdict = row.keep ? "保管" : "分解";
    lootSection.appendChild(forgeEl("div","forge-trial-slot" + (row.keep?" filled":""),
      verdict + " | " + row.item.name + " | OP " + rank + " | " + (why[row.reason]||row.reason)));
  });
  lootSection.appendChild(forgeEl("p","forge-trial-note",
    "現行ドロップのOPにはrank情報がないため、自動で希少と認定できません。今後OPランクの付与・保存と、自動分解への統合が必要です。"));

  const rollSection = forgeSection(body,"⑦ OPレアリティ・出現確率の試算",
    "武器レア度とOPランクを独立抽選する試験です。新しい確率はすべて暫定案で、実際のダンジョンドロップには未反映です。");
  const modeButtons = forgeEl("div","forge-trial-tabs");
  Object.entries(RarityTrial.MODES).forEach(function(entry){
    const key=entry[0],model=entry[1];
    modeButtons.appendChild(forgeButton(model.label,function(){
      forgeTrialLootMode=key;
      forgeTrialLootReport=null;
      forgeTrialRender();
    },false,"forge-trial-chip"+(key===forgeTrialLootMode?" selected":"")));
  });
  rollSection.appendChild(modeButtons);
  const model=RarityTrial.MODES[forgeTrialLootMode];
  rollSection.appendChild(forgeEl("p","forge-trial-note",
    "天然OP付与率（試案） "+(model.optionChance*100).toFixed(0)+"%。OPが付いた場合のランク比率："+
    RarityTrial.RANKS.map(function(rank){
      return rank.toUpperCase()+" "+(model.weights[rank]/100).toFixed(2).replace(/\.?0+$/,"")+"%";
    }).join(" / ")));
  const srChance=RarityTrial.probability(forgeTrialLootMode,"n","sr");
  const urChance=RarityTrial.probability(forgeTrialLootMode,"n","ur");
  const lrChance=RarityTrial.probability(forgeTrialLootMode,"n","lr");
  const chanceText=function(chance){return (chance*100).toFixed(3)+"%";};
  rollSection.appendChild(forgeEl("p","forge-trial-note",
    "N武器＋SR以上OP："+chanceText(srChance.perDrop)+
    " / N武器＋UR以上："+chanceText(urChance.perDrop)+
    " / N武器＋LR："+chanceText(lrChance.perDrop)+"（1ドロップあたりの理論値）"));
  const trialButtons=forgeEl("div","forge-trial-actions");
  [1000,10000].forEach(function(count){
    trialButtons.appendChild(forgeButton(count.toLocaleString("ja-JP")+"個を試抽選",function(){
      forgeTrialLootReport=RarityTrial.simulate({mode:forgeTrialLootMode,count,
        minRank:forgeTrialProtectRank,seed:20261014});
      forgeTrialRender();
    },false,"btn ghost"));
  });
  rollSection.appendChild(trialButtons);
  if(forgeTrialLootReport){
    const report=forgeTrialLootReport;
    rollSection.appendChild(forgeEl("p","forge-trial-rate",
      "抽選 "+report.count.toLocaleString("ja-JP")+"件：OPなし "+report.withoutOption+
      " / N武器＋SR以上OP "+report.nWithRare+" / N武器＋UR以上OP "+report.nWithUR+
      " / 特殊OP "+report.withSpecial));
    rollSection.appendChild(forgeEl("p","forge-trial-note",
      "OPランク別 "+RarityTrial.RANKS.map(function(rank){
        return rank.toUpperCase()+":"+report.rankCounts[rank];
      }).join(" / ")));
    rollSection.appendChild(forgeEl("p","forge-trial-note",
      "自動分解の参考値：SR/UR切替の現在の保護基準 "+report.minRank.toUpperCase()+
      "以上で保持 "+report.kept+"件 / 強化石 "+report.materials+
      "（保護なしなら "+report.materialsWithoutProtection+"）"));
    report.rareExamples.slice(0,5).forEach(function(op){
      const value=op.special?"特殊":(op.value*100).toFixed(1)+"%";
      rollSection.appendChild(forgeEl("div","forge-trial-slot",
        "武器 "+op.weaponRank.toUpperCase()+" / OP "+op.optionRank.toUpperCase()+
        " / "+op.key+" "+value));
    });
  }else{
    rollSection.appendChild(forgeEl("p","forge-trial-note",
      "抽選ボタンで結果を確認できます。同じ条件・シードなら同じ結果になる検証用の模擬抽選です。"));
  }
  rollSection.appendChild(forgeEl("p","forge-trial-note",
    "現行仕様では通常モードに天然OPは付きません。ハード/エクストラでは現在1～3個のOPが付きますが、この試算は比較を簡単にするため1装備につき最大1個として計算します。期待周回数は1周5個の仮定です。"));

  const balanceSection=forgeSection(body,"⑧ OP種類別の出現率・数値上限",
    "同じOPランクでも効果の種類で強さと希少性を変える比較案です。実戦の装備補正はまだ変更していません。");
  const rankButtons=forgeEl("div","forge-trial-tabs");
  RarityTrial.RANKS.forEach(function(rank){
    rankButtons.appendChild(forgeButton("OPランク "+rank.toUpperCase(),function(){
      forgeTrialFocusRank=rank;forgeTrialRender();
    },false,"forge-trial-chip"+(forgeTrialFocusRank===rank?" selected":"")));
  });
  balanceSection.appendChild(rankButtons);
  const kinds=forgeEl("div","forge-trial-kind-grid");
  Object.entries(RarityTrial.KIND_CATALOG).forEach(function(entry){
    const key=entry[0],details=entry[1];
    kinds.appendChild(forgeButton("OP: "+details.label,function(){
      forgeTrialFocusKind=key;forgeTrialRender();
    },false,"forge-trial-chip"+(forgeTrialFocusKind===key?" selected":"")));
  });
  balanceSection.appendChild(kinds);
  const details=RarityTrial.KIND_CATALOG[forgeTrialFocusKind];
  const range=details.ranges[forgeTrialFocusRank];
  const percent=function(x){return (x*100).toFixed(1)+"%";};
  const selectedChance=RarityTrial.probabilityForKind(forgeTrialLootMode,forgeTrialFocusRank,forgeTrialFocusKind);
  const nWeaponChance=RarityTrial.probabilityForKind(forgeTrialLootMode,forgeTrialFocusRank,forgeTrialFocusKind,"n");
  balanceSection.appendChild(forgeEl("p","forge-trial-rate",
    details.label+"："+percent(range[0])+" ～ "+percent(range[1])+"（"+forgeTrialFocusRank.toUpperCase()+"）"));
  balanceSection.appendChild(forgeEl("p","forge-trial-note",
    details.role+" / 通常OP内の出現比率 "+(details.weight/RarityTrial.KIND_CATALOG_WEIGHT*100).toFixed(1)+"%"));
  balanceSection.appendChild(forgeEl("p","forge-trial-note",
    RarityTrial.MODES[forgeTrialLootMode].label+"：このOPの"+forgeTrialFocusRank.toUpperCase()+
    "ランクが出る確率 "+(selectedChance.perDrop*100).toFixed(4)+"%/ドロップ"+
    " / N武器＋同OP "+(nWeaponChance.perDrop*100).toFixed(4)+"%/ドロップ"));
  if(forgeTrialLootReport){
    balanceSection.appendChild(forgeEl("p","forge-trial-note",
      "直近の"+forgeTrialLootReport.count.toLocaleString("ja-JP")+
      "件の試抽選に含まれる「"+details.label+"」："+forgeTrialLootReport.kindCounts[forgeTrialFocusKind]+
      "件（ランクを問わない合計）"));
  }
  const specialText=Object.entries(RarityTrial.SPECIAL_KEYS).map(function(entry){
    const rank=entry[0],key=entry[1];
    const p=RarityTrial.probabilityForKind(forgeTrialLootMode,rank,key);
    return (key==="element_reverse_earth"?"属性反転":"虚無共鳴")+"("+rank.toUpperCase()+") "+
      (p.perDrop*100).toFixed(4)+"%/ドロップ";
  });
  balanceSection.appendChild(forgeEl("p","forge-trial-note",
    "特殊OPは通常OPと別抽選："+specialText.join(" / ")+
    "。効果の適用条件、上限、ドロップ場所は今後の調整対象です。"));
  balanceSection.appendChild(forgeEl("p","forge-trial-note",
    "効果別の数値上限は仮値です。特に会心率、吸収、被ダメ軽減が重複した場合の上限は実戦統合前に別途検証します。"));

  const footer = forgeSection(body, "試作を最初からやり直す", "試作工房だけを初期化します。既存ゲームのセーブデータには触れません。");
  footer.appendChild(forgeButton("試作データをリセット", function () {
    if (!window.confirm("試作工房の進行を初期化しますか？（ゲーム本体のデータは残ります）")) return;
    forgeTrialState = ForgeTrial.createDemo();
    forgeTrialTarget = "sr";
    forgeTrialEnemyElement = "earth";
    forgeTrialRareProtection = true;
    forgeTrialProtectRank = "sr";
    forgeTrialLootMode = "hard";
    forgeTrialLootReport = null;
    forgeTrialFocusKind = "crit";
    forgeTrialFocusRank = "sr";
    forgeTrialEssenceId = null;
    forgeTrialMessage = "試作工房を初期化しました";
    forgeTrialWarning = false;
    forgeTrialSave();
    forgeTrialRender();
  }, false, "btn ghost forge-trial-wide"));
  // 画面再描画でiPhoneのスクロール位置が先頭へ飛ばないようにする。
  body.scrollTop = previousScroll;
}
document.getElementById("btnForgeTrialBack").addEventListener("click", openPartyMenu);
