import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedSupportShare } from '../src/application/services/MembershipActivityService.js';

test('primary only is 100% of available scope',()=>{
  assert.equal(weightedSupportShare(80,null,true,false,.7,.3),80);
});

test('70/30 is applied when both scopes exist',()=>{
  assert.equal(weightedSupportShare(100,0,true,true,.7,.3),70);
});

test('support-only period is not punished when primary has no eligible data',()=>{
  assert.equal(weightedSupportShare(null,80,false,true,.7,.3),80);
});

test('no attendance evidence returns null',()=>{
  assert.equal(weightedSupportShare(null,null,false,false,.7,.3),null);
});
