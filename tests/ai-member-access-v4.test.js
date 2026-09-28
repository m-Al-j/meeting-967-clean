import test from 'node:test';
import assert from 'node:assert/strict';
import { AIMemberAccessService } from '../src/application/services/AIMemberAccessService.js';

function permissionService({ owner=false, globals=[], teams=[] }={}){
  return {
    isOwner: () => owner,
    isSuperAdmin: async () => false,
    has: async (_subject,key,ctx={}) => {
      if (globals.includes(key) && !ctx.teamId) return true;
      return teams.some((x) => String(x.teamId)===String(ctx.teamId) && x.permission===key);
    },
  };
}

function dbFor({teams=[],members=[]}={}){
  return {
    async query(sql, params){
      if(sql.includes('SELECT id FROM teams')) return {rows:teams.map(x=>({id:x.id}))};
      if(sql.includes('SELECT id,name') && sql.includes('FROM teams')) return {rows:teams.filter(x=>String(x.name).toLowerCase()===String(params[1]).toLowerCase()).map(x=>({id:x.id,name:x.name}))};
      if(sql.includes('FROM team_members') && sql.includes('JOIN teams t')){
        const userId=String(params[1]);
        return {rows:members.filter(x=>String(x.userId)===userId && x.active!==false).map(x=>({id:x.teamId,name:x.teamName}))};
      }
      if(sql.includes('FROM users')) return {rows:[{id:'u1',username:'self',display_name:'Self'}]};
      throw new Error(`Unhandled SQL in test: ${sql.slice(0,120)}`);
    }
  };
}

test('owner can access all member teams',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'},{id:'t2',name:'B'}]}),
    permissionService:permissionService({owner:true}),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),['t1','t2']);
});

test('ordinary member has no other-member team scope',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'}]}),
    permissionService:permissionService(),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),[]);
});

test('team scoped members.view exposes only the granted team',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'},{id:'t2',name:'B'}]}),
    permissionService:permissionService({teams:[{teamId:'t1',permission:'members.view'}]}),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),['t1']);
});
