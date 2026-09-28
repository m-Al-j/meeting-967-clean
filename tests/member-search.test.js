import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {filterMemberOptions,setMemberSearch,getMemberSearch,clearMemberSearch} from '../src/interfaces/discord/memberSearchState.js';
import {DraftStore} from '../src/utils/draftStore.js';
import {isModalOpener} from '../src/interfaces/discord/interactionReliability.js';

const options=[
  {label:'محمد عبدالله الجابري',description:'@m.j404',value:'1'},
  {label:'أحمد علي سعيد',description:'@ahmed_967',value:'2'},
  {label:'سياف محمد',description:'@saeif',value:'3'}
];

test('member search finds Arabic display name and normalizes alef variants',()=>{
  assert.deepEqual(filterMemberOptions(options,'احمد').map(x=>x.value),['2']);
  assert.deepEqual(filterMemberOptions(options,'محمد عبدالله').map(x=>x.value),['1']);
});

test('member search finds Discord username with or without @',()=>{
  assert.deepEqual(filterMemberOptions(options,'@m.j404').map(x=>x.value),['1']);
  assert.deepEqual(filterMemberOptions(options,'m.j404').map(x=>x.value),['1']);
  assert.deepEqual(filterMemberOptions(options,'ahmed_967').map(x=>x.value),['2']);
});

test('member search state is scoped and can be cleared',()=>{
  const a={drafts:new DraftStore()};
  setMemberSearch(a,'u1','perm:grant','محمد');
  assert.equal(getMemberSearch(a,'u1','perm:grant'),'محمد');
  assert.equal(getMemberSearch(a,'u1','team:add:t1'),'');
  clearMemberSearch(a,'u1','perm:grant');
  assert.equal(getMemberSearch(a,'u1','perm:grant'),'');
});

test('member-search buttons are treated as modal openers',()=>{
  const interaction={customId:'perm:member-search:grant',isButton:()=>true,isAnySelectMenu:()=>false};
  assert.equal(isModalOpener(interaction),true);
});


test('search entry inside member select is treated as modal opener',()=>{
  const interaction={customId:'perm:subject:user',values:['__meeting967_member_search__'],isButton:()=>false,isAnySelectMenu:()=>true};
  assert.equal(isModalOpener(interaction),true);
});

test('member search UI includes search and clear actions',()=>{
  const source=fs.readFileSync(new URL('../src/interfaces/discord/memberSearch.js',import.meta.url),'utf8');
  assert.match(source,/بحث بالاسم أو اليوزر/);
  assert.match(source,/إلغاء البحث/);
});
