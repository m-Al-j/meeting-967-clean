import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MemberSuggestionService} from '../src/application/services/MemberSuggestionService.js';
import {smartMemberHint} from '../src/interfaces/discord/smartMemberSearch.js';

test('member suggestions require no usage repository',async()=>{
  const service=new MemberSuggestionService();
  const out=await service.suggestions({options:[
    {label:'سالم صالح',description:'@salem',value:'1'},
    {label:'محمد سالم',description:'@moh',value:'2'}
  ],query:'سا',limit:25});
  assert.equal(out[0].value,'1');
  assert.deepEqual(out.map(x=>x.value),['1','2']);
});

test('app no longer wires member picker usage history into suggestions',()=>{
  const src=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.equal(src.includes('MemberPickerUsageRepository'),false);
  assert.equal(src.includes('memberPickerUsage'),false);
});

test('router no longer records previous member selections',()=>{
  const src=fs.readFileSync(new URL('../src/interfaces/discord/router.js',import.meta.url),'utf8');
  assert.equal(src.includes('recordSelection'),false);
  assert.equal(src.includes('pickerSearchValue'),false);
});

test('user hint explicitly says name-only ranking',()=>{
  const hint=smartMemberHint();
  assert.match(hint,/حسب الاسم فقط/);
  assert.match(hint,/بدون سجل مراسلات أو اختيارات سابقة/);
});
