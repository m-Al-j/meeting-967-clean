import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('src/interfaces/discord');
function walk(dir){
  const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...walk(p));
    else if(e.isFile()&&p.endsWith('.js'))out.push(p);
  }
  return out;
}

test('DM replies are not hard-coded ephemeral',()=>{
  const offenders=[];
  for(const file of walk(root)){
    const src=fs.readFileSync(file,'utf8');
    if(src.includes('ephemeral:true'))offenders.push(path.relative(root,file));
  }
  assert.deepEqual(offenders,[]);
});
