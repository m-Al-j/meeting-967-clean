import test from 'node:test';
import assert from 'node:assert/strict';
import {setSmartMemberContext,getSmartMemberContext,isTrackedMemberSelectionId} from '../src/interfaces/discord/smartMemberSearch.js';

class Drafts{constructor(){this.m=new Map();}set(k,v){this.m.set(k,v);}get(k){return this.m.get(k)??null;}delete(k){this.m.delete(k);}}

test('stores current picker so slash autocomplete is scoped to the same list',()=>{
  const a={drafts:new Drafts()};
  setSmartMemberContext(a,'10',{customId:'perm:subject:user',options:[{label:'A',description:'@a',value:'1'}],context:'perm:grant'});
  const c=getSmartMemberContext(a,'10');
  assert.equal(c.customId,'perm:subject:user');
  assert.equal(c.options[0].value,'1');
});

test('recognizes member selection ids but not unrelated selects',()=>{
  assert.equal(isTrackedMemberSelectionId('perm:subject:user'),true);
  assert.equal(isTrackedMemberSelectionId('team:add-user:abc'),true);
  assert.equal(isTrackedMemberSelectionId('attendance:edit:abc'),true);
  assert.equal(isTrackedMemberSelectionId('perm:scope-team'),false);
});
