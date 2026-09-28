import test from 'node:test';
import assert from 'node:assert/strict';
import {pickerPage} from '../src/interfaces/discord/guildPicker.js';

test('super-admin member picker supports more than 25 members',()=>{
  const rows=Array.from({length:61},(_,i)=>({label:`عضو ${i+1}`,value:String(i+1)}));
  const p1=pickerPage(rows,0);
  const p2=pickerPage(rows,1);
  const p3=pickerPage(rows,2);
  assert.equal(p1.items.length,25);
  assert.equal(p2.items.length,25);
  assert.equal(p3.items.length,11);
  assert.equal(p3.pages,3);
});
