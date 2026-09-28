import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSmartMemberOptions} from '../src/interfaces/discord/smartMemberRanking.js';

const options=[
  {label:'محمد عبدالله',description:'@mohammed_967',value:'1'},
  {label:'موسى صالح',description:'@mousa_32056',value:'2'},
  {label:'محمد فؤاد',description:'@fouad_m',value:'3'},
  {label:'أحمد محمد',description:'@ahmed_m',value:'4'}
];

test('first letters filter by display name or username',()=>{
  assert.deepEqual(rankSmartMemberOptions(options,'مو',[],{limit:25}).map(x=>x.value),['2']);
  assert.deepEqual(rankSmartMemberOptions(options,'moh',[],{limit:25}).map(x=>x.value),['1']);
});

test('ranking ignores historical usage completely',()=>{
  const usage=[{target_user_id:'3',use_count:999,last_used_at:'2026-08-23T03:59:00Z'}];
  const withoutHistory=rankSmartMemberOptions(options,'محمد',[],{limit:25}).map(x=>x.value);
  const withHistory=rankSmartMemberOptions(options,'محمد',usage,{limit:25}).map(x=>x.value);
  assert.deepEqual(withHistory,withoutHistory);
});

test('display-name prefix is preferred to token/contains matches',()=>{
  const ranked=rankSmartMemberOptions(options,'محمد',[],{limit:25});
  assert.deepEqual(ranked.slice(0,2).map(x=>x.value),['1','3']);
  assert.equal(ranked.at(-1).value,'4');
});

test('username accepts @ prefix normalization',()=>{
  const ranked=rankSmartMemberOptions(options,'@fou',[],{limit:25});
  assert.deepEqual(ranked.map(x=>x.value),['3']);
});

test('without a query members are sorted by name only',()=>{
  const ranked=rankSmartMemberOptions(options,'',[],{limit:25});
  assert.deepEqual(ranked.map(x=>x.value),['4','1','3','2']);
});
