import test from 'node:test';
import assert from 'node:assert/strict';
import {pickerPage} from '../src/interfaces/discord/guildPicker.js';

test('picker paginates more than 25 guild members',()=>{
  const options=Array.from({length:63},(_,i)=>({label:`User ${i+1}`,value:String(i+1)}));
  const first=pickerPage(options,0);const second=pickerPage(options,1);const last=pickerPage(options,99);
  assert.equal(first.items.length,25);assert.equal(first.pages,3);assert.equal(first.start,0);assert.equal(first.end,25);
  assert.equal(second.items[0].value,'26');assert.equal(second.end,50);
  assert.equal(last.page,2);assert.equal(last.items.length,13);assert.equal(last.items.at(-1).value,'63');
});
