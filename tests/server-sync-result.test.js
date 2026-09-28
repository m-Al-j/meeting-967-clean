import test from 'node:test';
import assert from 'node:assert/strict';

test('partial server sync can report warnings without fatal failure',()=>{
 const out={teams:2,linkedVoice:2,errors:[{name:'x',reason:'y'}]};
 assert.equal(out.teams,2);
 assert.equal(out.errors.length,1);
 assert.ok(out.linkedVoice>0);
});
