import test from 'node:test';import assert from 'node:assert/strict';import {assertMeetingTransition} from '../src/core/meetings/state.js';
test('valid lifecycle',()=>{assert.equal(assertMeetingTransition('upcoming','ongoing'),true);assert.equal(assertMeetingTransition('ongoing','ended'),true);assert.equal(assertMeetingTransition('upcoming','postponed'),true);assert.equal(assertMeetingTransition('postponed','ongoing'),true);});
test('cannot reopen ended',()=>assert.throws(()=>assertMeetingTransition('ended','ongoing')));
