const test=require("node:test");
const assert=require("node:assert/strict");
const Gear=require("../js/core/forge-gear-trial.js");
const Legacy=require("../js/core/option-inheritance-trial.js");

function extract(s,key){
 const w=s.sources.find(w=>w.optionKey===key);
 assert.ok(w,"test source for "+key);
 const r=Gear.extractSource(s,w.id);assert.equal(r.ok,true,r.message);
 return s.essences[s.essences.length-1];
}
function ready(s,id){
 for(const level of Gear.SLOT_LEVELS[id]){
  assert.equal(Gear.enhance(s,id,level).ok,true);
  const r=Gear.openSocket(s,id);
  if(!r.ok&&r.message.includes("満枠"))break;
  assert.equal(r.ok,true,r.message);
 }
}
test("新試作は天然OP付きSR、装備属性、抽出済み保護と独立した保存構造を持つ",()=>{
 const s=Gear.createDemo(),t=s.targets.find(t=>t.id==="sr");
 assert.equal(s.version,2);
 assert.equal(s.sources.length,5);
 assert.equal(t.naturalOptions[0].key,"guard");
 assert.equal(t.attackElement,"fire");
 assert.deepEqual(Gear.inspect(t).naturalCount,1);
 assert.equal(Gear.isValid(s),true);
});

test("SRの天然OPを残して+50で1穴継承すると合計2枠で満枠。+99でも増殖しない",()=>{
 const s=Gear.createDemo(),t=s.targets.find(t=>t.id==="sr");
 assert.equal(Gear.enhance(s,"sr",50).ok,true);
 assert.equal(Gear.openSocket(s,"sr").ok,true);
 const e=extract(s,"atk");
 const success=Gear.inherit(s,"sr",e.id,false,()=>1);
 assert.equal(success.success,true);
 assert.equal(t.options[0].value,.05);
 assert.equal(t.options[0].rank,"r");
 assert.equal(Gear.inspect(t).total,2);
 assert.equal(Gear.enhance(s,"sr",99).ok,true);
 assert.equal(Gear.openSocket(s,"sr").ok,false);
 assert.equal(t.opened,1);
 assert.equal(Gear.isValid(s),true);
});

test("SRから天然OPを抽出すると武器・継承OP・強化・穴が残り、次の穴を開けられる",()=>{
 const s=Gear.createDemo(),t=s.targets.find(t=>t.id==="sr");
 Gear.enhance(s,"sr",50);Gear.openSocket(s,"sr");
 const e=extract(s,"atk");
 assert.equal(Gear.inherit(s,"sr",e.id,false).success,true);
 Gear.enhance(s,"sr",99);
 const id=t.id,plus=t.plus;
 const result=Gear.extractTarget(s,"sr",0);
 assert.equal(result.ok,true,result.message);
 assert.equal(t.id,id);
 assert.equal(t.plus,plus);
 assert.equal(t.opened,1);
 assert.equal(t.options.length,1);
 assert.equal(t.naturalOptions.length,0);
 const guard=s.essences.find(e=>e.key==="guard");
 assert.equal(guard.rank,"n");
 assert.equal(guard.sourceRarity,"sr");
 assert.equal(Gear.openSocket(s,"sr").ok,true);
 assert.equal(Gear.inspect(t).freeInheritedSockets,1);
 assert.equal(Gear.validate(s,"sr",guard.id,false).ok,false,"SR origin cannot transfer to SR");
 assert.equal(Gear.isValid(s),true);
});

test("低レア天然の希少OPをURへ直接継承し、数値とrankを保持する",()=>{
 const s=Gear.createDemo();ready(s,"ur");
 const e=extract(s,"crit");
 const r=Gear.inherit(s,"ur",e.id,true,()=>.999);
 assert.equal(r.success,true);
 const t=s.targets.find(t=>t.id==="ur"),o=t.options[0];
 assert.equal(o.key,"crit");
 assert.equal(o.value,.10);
 assert.equal(o.rank,"sr");
 assert.equal(o.sourceRarity,"n");
 assert.equal(o.origin,"inherited");
 assert.equal(s.trialLiquid,1);
 assert.equal(Gear.isValid(s),true);
});

test("UR天井・確定液の使用、失敗で武器本体が残ることを検証",()=>{
 const s=Gear.createDemo();ready(s,"ur");
 const t=s.targets.find(t=>t.id==="ur");
 for(let i=0;i<2;i++){
  if(i)Gear.addSamples(s);
  const e=extract(s,"atk");
  const before=Gear.inspect(t);
  const r=Gear.inherit(s,"ur",e.id,false,()=>.999);
  assert.equal(r.success,false);
  assert.equal(t.failures,i+1);
  assert.equal(t.opened,before.openedSockets);
  assert.equal(t.options.length,0);
 }
 Gear.addSamples(s);const e=extract(s,"crit");
 const paid=Gear.inherit(s,"ur",e.id,true,()=>0);
 assert.equal(paid.ok,false,"天井済みで有料液を消費させない");
 assert.equal(s.trialLiquid,2);
 assert.ok(s.essences.includes(e));
 const hit=Gear.inherit(s,"ur",e.id,false,()=>.999);
 assert.equal(hit.pityHit,true);
 assert.equal(hit.success,true);
 assert.equal(t.failures,0);
 assert.equal(Gear.isValid(s),true);
});

test("OP重複・特殊OP二個目・元武器同ランクの継承を防ぐ",()=>{
 const s=Gear.createDemo();ready(s,"lr");
 const a=extract(s,"reverse");
 assert.equal(Gear.inherit(s,"lr",a.id,true).success,true);
 const v=extract(s,"void");
 assert.equal(Gear.validate(s,"lr",v.id,false).ok,false);
 const r=extract(s,"atk");
 const t=s.targets.find(t=>t.id==="r");
 Gear.enhance(s,"r",50);Gear.openSocket(s,"r");
 assert.equal(Gear.validate(s,"r",r.id,false).ok,false);
 assert.equal(Gear.isValid(s),true);
});

test("武器属性×土敵の通常・抑制・虚無無効の倍率が確認でき、反転OPを実際に参照",()=>{
 const s=Gear.createDemo();const t=s.targets.find(t=>t.id==="lr");
 Gear.setElement(s,"lr","void");
 assert.deepEqual(Gear.compare(s,"lr","earth").map(v=>v.multiplier),[1.15,0.8049999999999999,0]);
 Gear.setElement(s,"lr","wood");
 assert.deepEqual(Gear.compare(s,"lr","earth").map(v=>v.multiplier),[1.3,1.3,1.3]);
 ready(s,"lr");
 Gear.setElement(s,"lr","fire");
 const e=extract(s,"reverse");
 assert.equal(Gear.inherit(s,"lr",e.id,true).success,true);
 assert.deepEqual(Gear.compare(s,"lr","earth").map(v=>v.multiplier),[1.3,1.3,1.3]);
 assert.equal(Gear.compare(s,"lr","earth")[0].reversed,true);
 assert.equal(Gear.isValid(s),true);
});

test("旧試作v1の強化・穴・液体・天井進捗を破壊せずv2へ移行",()=>{
 const old=Legacy.createDemo();
 Legacy.increasePlus(old,"sr",50);Legacy.openSocket(old,"sr");
 Legacy.extract(old,old.sources[0].id);
 old.targets.find(t=>t.id==="ur").failures=1;
 const original=JSON.stringify(old);
 const restored=Gear.upgradeFromV1(old);
 assert.equal(Gear.isValid(restored),true);
 assert.equal(JSON.stringify(old),original);
 assert.equal(restored.targets.find(t=>t.id==="sr").opened,1);
 assert.equal(restored.targets.find(t=>t.id==="ur").failures,1);
 assert.equal(restored.essences[0].value,.05);
 assert.equal(restored.essences[0].rank,"r");
 assert.equal(restored.targets.find(t=>t.id==="sr").naturalOptions.length,0,"old gear not modified with new natural options");
});
test("試作保存データが破損していても拒否し、メインセーブとは無関係",()=>{
 const s=Gear.createDemo();assert.equal(Gear.isValid(s),true);
 const clone=()=>JSON.parse(JSON.stringify(s));
 let bad=clone();bad.targets[1].naturalOptions=[{key:"invalid"}];assert.equal(Gear.isValid(bad),false);
 bad=clone();bad.targets[1].attackElement="holy";assert.equal(Gear.isValid(bad),false);
 bad=clone();bad.essences.push({id:"ess_999",key:"atk",value:.05});assert.equal(Gear.isValid(bad),false);
 bad=clone();bad.targets[1].plus=-100;assert.equal(Gear.isValid(bad),false);
 assert.equal(Gear.upgradeFromV1({version:1,targets:null}),null);
});
