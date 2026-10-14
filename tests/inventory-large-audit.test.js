"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Audit=require("../tools/lib/inventory-large-audit.js");
const Storage=require("../js/core/storage.js");
const Save=require("../js/model/save.js");
const data=require("../tools/lib/load-data.js").loadGameData();

test("現行モデルの2,500/5,000/10,000装備で全件保存・復元と一括分解を検証",()=>{
 const rows=Audit.run();
 assert.deepEqual(rows.map(r=>r.count),[2500,5000,10000]);
 for(const r of rows){
  assert.equal(r.sortedCount,r.count);
  assert.equal(r.remaining+r.safeDisassembled,r.count);
  assert.ok(r.valuable>0 && r.protectedCountAfterBulk===r.valuable);
  assert.ok(r.serializedChars>0 && r.utf8Bytes>=r.serializedChars);
  assert.ok(r.ms.serialize>=0 && r.ms.deserialize>=0 && r.ms.dismantle>=0);
 }
 assert.ok(rows[2].serializedChars>rows[1].serializedChars);
 assert.ok(rows[1].serializedChars>rows[0].serializedChars);
 console.log("INVENTORY_LOAD_AUDIT "+JSON.stringify(rows));
});
test("10,000件セーブが仮の容量上限を超えても既存セーブを破壊しない",()=>{
 const state=Audit.createFixture(10000,data);
 const json=JSON.stringify(Save.serialize(state,{now:1700000000000}));
 const limit=5000; // 一部容量しか空いていない端末を再現
 const previous='{"roster":[{"id":"before"}],"inventory":[{"id":"valuable"}]}';
 const backend=Storage.createMemoryBackend({[Storage.KEYS.save]:previous},limit);
 let errors=0;
 const store=Storage.createStorage(backend,{onWriteError:(err,key)=>{
  assert.equal(err.name,"QuotaExceededError");
  assert.equal(key,Storage.KEYS.save);errors++;
 }});
 assert.equal(store.set(Storage.KEYS.save,json),false);
 assert.equal(store.getString(Storage.KEYS.save),previous);
 assert.equal(errors,1);
 // 本番実装と同じセーブを読み込めることを検証（追加の永続化フィールドなし）
 const decoded=Save.deserialize(JSON.parse(json),{legacyItemBases:data.LEGACY_ITEM_BASES,maxPlus:99});
 assert.equal(decoded.state.inventory.length,10000);
 for(const n of [0,71,73,2500,9999]){
  assert.equal(decoded.state.inventory[n].id,"load-"+n);
  assert.equal(decoded.state.inventory[n].locked,state.inventory[n].locked);
  assert.deepEqual(decoded.state.inventory[n].options,state.inventory[n].options);
 }
});
test("不正件数は拒否し、1万件の編集でも元セーブを勝手に削除しない",()=>{
 assert.throws(()=>Audit.createFixture(0,data),/Invalid fixture size/);
 assert.throws(()=>Audit.createFixture(20001,data),/Invalid fixture size/);
 const s=Audit.createFixture(10000,data);
 const ids=new Set(s.inventory.map(x=>x.id));
 assert.equal(ids.size,10000);
 assert.equal(s.inventory.filter(x=>x.locked).length>0,true);
});
