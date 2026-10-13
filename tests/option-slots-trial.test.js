const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/core/option-slots-trial.js");

const item = (rarity, plus, options = [], opened = 0) =>
  ({id: "weapon-1", rarity, plus, slot:"weapon", name:"テスト武器", options, sockets:{opened}});
const op = (key, value, origin, other = {}) => ({key, value, origin, ...other});
const material = (key, sourceItemRarity, extra = {}) => ({key, value:0.05, rank:"r", sourceItemRarity, ...extra});

test("N/R/SR/UR/LRの合計OP上限が1/1/2/3/4、穴あけ段階も一致", () => {
  assert.deepEqual(S.MAX_OPTIONS,{n:1,r:1,sr:2,ur:3,lr:4});
  assert.deepEqual(S.SOCKET_THRESHOLDS.sr,[50,99]);
  assert.deepEqual(S.SOCKET_THRESHOLDS.ur,[25,50,99]);
  assert.deepEqual(S.SOCKET_THRESHOLDS.lr,[25,50,75,99]);
  assert.equal(S.inspect(item("n",99)).canOpenNext,false);
  assert.equal(S.inspect(item("r",49)).canOpenNext,false);
});

test("SR+50は1枠、+99は2枠。+値到達だけでは開かない", () => {
  let weapon = item("sr", 50);
  assert.equal(S.inspect(weapon).nextThreshold,50);
  assert.equal(S.inspect(weapon).canInherit,false);
  let r = S.openNextSocket(weapon);
  assert.equal(r.ok,true);
  weapon = r.item;
  assert.equal(S.inspect(weapon).openedSockets,1);
  assert.equal(S.inspect(weapon).nextThreshold,99);
  assert.deepEqual(S.openNextSocket(weapon),{ok:false,reason:"enhance_first",requiredPlus:99});
  weapon = {...weapon,plus:99};
  r = S.openNextSocket(weapon);
  assert.equal(r.ok,true);
  assert.equal(S.inspect(r.item).openedSockets,2);
  assert.equal(S.openNextSocket(r.item).reason,"max_sockets");
});

test("天然OP1個のSRは穴あけ1個で合計2。+99でも天然+継承が上限超過しない", () => {
  let w = item("sr",50,[op("atk_pct",0.05,"natural")]);
  w = S.openNextSocket(w).item;
  const value = material("crit","n",{value:0.10,rank:"sr"});
  const appended = S.appendInherited(w,value);
  assert.equal(appended.ok,true);
  const state = S.inspect(appended.item);
  assert.equal(state.naturalCount,1);
  assert.equal(state.inheritedCount,1);
  assert.equal(state.total,2);
  assert.equal(state.freeTotal,0);
  assert.equal(S.validateInheritance(appended.item,material("spd_pct","n")).reason,"full");
  assert.equal(S.openNextSocket({...appended.item,plus:99}).reason,"full");
  assert.equal(S.inspect(w).total,1,"before-inherit input unchanged");
});

test("天然2個の旧SR装備は上限内で維持。抽出してから開ける", () => {
  const old = item("sr",99,[{key:"atk_pct",value:0.05},{key:"crit",value:0.1}]);
  assert.equal(S.inspect(old).naturalCount,2);
  assert.equal(S.openNextSocket(old).reason,"full");
  const removal = S.extractNatural(old,1);
  assert.equal(removal.ok,true);
  assert.equal(removal.option.value,0.1);
  assert.equal(removal.item.id,old.id);
  assert.equal(removal.item.options.length,1);
  assert.equal(old.options.length,2);
  const opened = S.openNextSocket(removal.item);
  assert.equal(opened.ok,true);
  assert.equal(S.validateInheritance(opened.item,material("crit","n")).ok,true);
});

test("上限超過した旧OPは消さずに保持し、追加継承は拒否。後から個別抽出で回復", () => {
  let old = item("n",10,[{key:"atk",value:7},{key:"crit",value:0.02},{key:"heal",value:0.1}]);
  assert.equal(S.inspect(old).overCapacity,2);
  assert.equal(S.inspect(old).total,3);
  assert.equal(S.validateInheritance(old,material("x","n")).ok,false);
  const first = S.extractNatural(old,0);
  assert.equal(first.ok,true);
  const second = S.extractNatural(first.item,0);
  assert.equal(second.ok,true);
  assert.equal(S.inspect(second.item).overCapacity,0);
  assert.equal(S.inspect(second.item).total,1);
  assert.equal(old.options.length,3);
});

test("継承済みOPは再抽出不可。天然OPだけ外して元武器は保持", () => {
  const w = item("sr",99,[
    op("atk_pct",0.05,"natural"),
    op("crit",0.10,"inherited")
  ],1);
  assert.equal(S.extractNatural(w,1).reason,"inherited_cannot_extract");
  const r = S.extractNatural(w,0);
  assert.equal(r.ok,true);
  assert.equal(r.item.plus,99);
  assert.equal(r.item.sockets.opened,1);
  assert.equal(r.item.options.length,1);
  assert.equal(r.item.options[0].origin,"inherited");
});

test("下位武器→上位武器のみで、Nの希少OPが直接URにも継承可能", () => {
  const ur = item("ur",25,[],1);
  const rareOP = material("element_reverse_earth","n",
    {value:1,rank:"ur",special:true});
  const result = S.appendInherited(ur,rareOP);
  assert.equal(result.ok,true);
  assert.equal(result.item.options[0].sourceItemRarity,"n");
  assert.equal(result.item.options[0].value,1);
  assert.equal(result.item.options[0].rank,"ur");
  assert.equal(result.item.options[0].origin,"inherited");
  assert.equal(S.appendInherited(item("sr",50,[],1),material("crit","sr")).reason,"lower_to_higher_only");
  assert.equal(S.appendInherited(item("r",50,[],1),material("crit","ur")).reason,"lower_to_higher_only");
});

test("未解放穴への継承不可、同一キー重複と特殊OP2件目を拒否", () => {
  const fresh = item("lr",99);
  assert.equal(S.validateInheritance(fresh,material("crit","n")).reason,"needs_socket");
  const w = item("lr",99,[op("element_reverse_earth",1,"natural",{group:"special"})],2);
  assert.equal(S.validateInheritance(w,material("element_reverse_earth","sr")).reason,"duplicate");
  assert.equal(S.validateInheritance(w,material("void_resonance","ur",{special:true})).reason,"special_limit");
  assert.equal(S.validateInheritance(w,material("atk_pct","n")).ok,true);
});

test("無効な入力は消費・破壊せず、エラーとして扱う", () => {
  const w = item("sr",99);
  assert.equal(S.extractNatural(w,0).reason,"missing_option");
  assert.equal(S.validateInheritance(w,material("atk","unknown")).reason,"invalid_material");
  assert.equal(S.validateInheritance(w,material("atk","n",{value:Infinity})).reason,"invalid_material");
  assert.equal(S.validateInheritance(w,material("atk","n",{rank:"unknown"})).reason,"invalid_material");
  assert.throws(() => S.inspect(item("sr",99,[op("crit",0.1,"inherited")],0)),/Inherited options/);
  assert.throws(() => S.inspect({...w,rarity:"x"}),/rarity/);
  assert.throws(() => S.inspect({...w,options:null}),/array/);
  assert.throws(() => S.inspect({...w,sockets:{opened:2},plus:50}),/milestones/);
});
