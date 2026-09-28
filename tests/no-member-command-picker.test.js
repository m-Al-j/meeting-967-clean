import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rankMemberOptionsForPicker,smartMemberHint} from '../src/interfaces/discord/smartMemberSearch.js';

test('member search does not register a /member command',()=>{
  const src=fs.readFileSync(new URL('../src/infrastructure/discord/commandDefinitions.js',import.meta.url),'utf8');
  assert.equal(src.includes("setName('member')"),false);
});

test('picker hint asks for plain name/username only',()=>{
  const hint=smartMemberHint();
  assert.match(hint,/الاسم أو اليوزر/);
  assert.equal(hint.includes('`/member`'),false);
});

test('picker ranking delegates only the typed query and options',async()=>{
  let received=null;
  const a={env:{GUILD_ID:'g'},memberSuggestionService:{suggestions:async args=>{received=args;return [...args.options].reverse();}}};
  const out=await rankMemberOptionsForPicker(a,'actor',[{label:'A',value:'1'},{label:'B',value:'2'}],'م');
  assert.equal(received.query,'م');
  assert.deepEqual(out.map(x=>x.value),['2','1']);
});
