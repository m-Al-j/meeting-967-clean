import test from 'node:test';
import assert from 'node:assert/strict';
import {navigablePickerPage,pickerNavigationPage,pickerSearchValue} from '../src/interfaces/discord/guildPicker.js';

test('member picker exposes search and next page inside same dropdown',()=>{
  const options=Array.from({length:91},(_,i)=>({label:`User ${i+1}`,value:String(i+1)}));
  const p=navigablePickerPage(options,0);
  assert.equal(p.pages,5);
  assert.equal(p.dataItems.length,22);
  assert.equal(p.items[0].label,'🔎 بحث بالاسم أو اليوزر');
  assert.equal(pickerSearchValue(p.items[0].value),true);
  assert.equal(p.items[1].label,'➡️ الصفحة التالية');
  assert.equal(pickerNavigationPage(p.items[1].value),1);
  assert.ok(p.items.length<=25);
});

test('middle member page exposes search previous and next without exceeding Discord limit',()=>{
  const options=Array.from({length:91},(_,i)=>({label:`User ${i+1}`,value:String(i+1)}));
  const p=navigablePickerPage(options,1);
  assert.equal(p.items[0].label,'🔎 بحث بالاسم أو اليوزر');
  assert.equal(p.items[1].label,'⬅️ الصفحة السابقة');
  assert.equal(p.items[2].label,'➡️ الصفحة التالية');
  assert.equal(pickerNavigationPage(p.items[1].value),0);
  assert.equal(pickerNavigationPage(p.items[2].value),2);
  assert.ok(p.items.length<=25);
});
