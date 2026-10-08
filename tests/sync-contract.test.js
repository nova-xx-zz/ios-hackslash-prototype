"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const model=require("../js/model/save.js");
const {progressDto,revisionDecision}=require("../js/core/sync-contract.js");
test("progress DTO excludes local financial claims without mutating source",()=>{
  const source={schemaVersion:2,roster:[{name:"test"}],purchases:{unlocks:{speed5:true}},guaranteedStones:{free:10,paid:1000},jobGrants:{pilgrim:true},material:123};
  const dto=progressDto(source);
  assert.equal(dto.purchases,undefined);assert.equal(dto.guaranteedStones,undefined);assert.equal(dto.jobGrants,undefined);
  assert.equal(dto.material,123);assert.equal(dto.roster[0].name,"test");
  dto.roster[0].name="edited";assert.equal(source.roster[0].name,"test");
});
test("optimistic backup revision rejects stale writers and mismatched retries",()=>{
  assert.deepEqual(revisionDecision({expectedRevision:1,currentRevision:2,operationId:"A",payloadHash:"x"}),{status:"conflict",httpStatus:409,revision:2});
  assert.deepEqual(revisionDecision({expectedRevision:2,currentRevision:2,operationId:"A",payloadHash:"x"}),{status:"accept",httpStatus:200,nextRevision:3});
  const op={operationId:"A",payloadHash:"x",resultRevision:3};
  assert.equal(revisionDecision({expectedRevision:2,currentRevision:3,operationId:"A",payloadHash:"x",previousOperation:op}).status,"replay");
  assert.equal(revisionDecision({expectedRevision:2,currentRevision:3,operationId:"A",payloadHash:"y",previousOperation:op}).status,"mismatch");
});
test("future schema cannot be downgraded by deserialize or cloud restore",()=>{
  const future={schemaVersion:model.SCHEMA_VERSION+1,roster:[{name:"future"}]};
  assert.equal(model.deserialize(future,{}),null);
  assert.equal(model.prepareRestore(JSON.stringify(future)),null);
});
