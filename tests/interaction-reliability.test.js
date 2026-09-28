import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgeEarly,handlerForCustomId,isModalOpener,safeInteraction} from '../src/interfaces/discord/interactionReliability.js';

function fake(kind='button',customId='perm:grant-role'){
  const calls=[];
  const i={customId,guildId:null,deferred:false,replied:false,calls,values:[],
    isButton:()=>kind==='button',isAnySelectMenu:()=>kind==='select',isModalSubmit:()=>kind==='modal',isChatInputCommand:()=>kind==='command',
    async deferUpdate(){calls.push('deferUpdate');this.deferred=true;},
    async deferReply(x){calls.push(['deferReply',x]);this.deferred=true;},
    async update(x){calls.push(['update',x]);this.replied=true;},
    async reply(x){calls.push(['reply',x]);this.replied=true;},
    async editReply(x){calls.push(['editReply',x]);return x;},
    async followUp(x){calls.push(['followUp',x]);return x;}
  };
  return i;
}

test('permission select is acknowledged before expensive work and update becomes editReply',async()=>{
  const raw=fake('select','perm:revoke-subject:role');
  await acknowledgeEarly(raw);
  assert.equal(raw.deferred,true);
  assert.equal(raw.calls[0],'deferUpdate');
  const i=safeInteraction(raw);
  await i.update({content:'ok'});
  assert.equal(raw.calls[1][0],'editReply');
});

test('modal opener is never pre-deferred',async()=>{
  const raw=fake('select','meeting:create:team');
  assert.equal(isModalOpener(raw),true);
  await acknowledgeEarly(raw);
  assert.equal(raw.deferred,false);
});

test('modal submission gets an early deferred reply',async()=>{
  const raw=fake('modal','meeting:edit-submit:123');
  await acknowledgeEarly(raw);
  assert.equal(raw.deferred,true);
  assert.equal(raw.calls[0][0],'deferReply');
});

test('direct router classification avoids running every interaction module',()=>{
  assert.equal(handlerForCustomId('perm:grant-role'),'permissions');
  assert.equal(handlerForCustomId('meeting:task:123'),'tasks');
  assert.equal(handlerForCustomId('meeting:view:123'),'meetings');
  assert.equal(handlerForCustomId('team:view:123'),'teams');
  assert.equal(handlerForCustomId('archive:search'),'misc');
});


test('member search select sentinel is not deferred so it can open a modal',async()=>{
  const raw=fake('select','perm:subject:user');
  raw.values=['__meeting967_member_search__'];
  assert.equal(isModalOpener(raw),true);
  await acknowledgeEarly(raw);
  assert.equal(raw.deferred,false);
});
