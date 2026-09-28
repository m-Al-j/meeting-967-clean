import test from 'node:test';
import assert from 'node:assert/strict';
import {pickerMenuPage,pickerPageValue,pickerSearchValue,PICKER_PAGE_PREFIX,PICKER_SEARCH_VALUE} from '../src/interfaces/discord/guildPicker.js';

test('member picker exposes search and next/previous inside the same 25-option menu',()=>{
  const options=Array.from({length:91},(_,i)=>({label:`u${i+1}`,value:String(i+1)}));
  const first=pickerMenuPage(options,0);
  assert.equal(first.items.length,22);
  assert.equal(first.menuItems.length,24); // search + next + 22 members
  assert.equal(first.menuItems[0].value,PICKER_SEARCH_VALUE);
  assert.equal(pickerSearchValue(first.menuItems[0].value),true);
  assert.equal(first.menuItems[1].value,`${PICKER_PAGE_PREFIX}1`);

  const middle=pickerMenuPage(options,1);
  assert.equal(middle.menuItems.length,25); // search + prev + next + 22 members
  assert.equal(middle.menuItems[0].value,PICKER_SEARCH_VALUE);
  assert.equal(pickerPageValue(middle.menuItems[1].value),0);
  assert.equal(pickerPageValue(middle.menuItems[2].value),2);
  assert.equal(pickerPageValue('123'),null);
  assert.equal(pickerSearchValue('123'),false);
});
