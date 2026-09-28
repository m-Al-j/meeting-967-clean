import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(name)=>fs.readFileSync(new URL(`../src/interfaces/discord/interactions/${name}.js`,import.meta.url),'utf8');

test('every member-picker interaction module routes the in-menu search entry',()=>{
  for(const name of ['permissions','teams','tasks','attendance']){
    const source=read(name);
    assert.match(source,/pickerSearchValue/,[name,'must recognize in-menu search'].join(' '));
    assert.match(source,/showModal\(memberSearchModal/,[name,'must open search modal'].join(' '));
  }
});

test('team move member picker uses the correct team id segment',()=>{
  const source=read('teams');
  assert.match(source,/const fromTeamId=id\.split\(':'\)\[2\]/);
});
