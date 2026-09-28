import test from 'node:test';import assert from 'node:assert/strict';import {assertExcuseDecision} from '../src/core/excuses/state.js';
test('pending can be approved/rejected',()=>{assert.equal(assertExcuseDecision('pending','approved'),true);assert.equal(assertExcuseDecision('pending','rejected'),true);});
test('final excuse cannot be decided again',()=>assert.throws(()=>assertExcuseDecision('approved','rejected')));
