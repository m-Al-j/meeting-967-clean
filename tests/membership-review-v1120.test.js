import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(
  'src/application/services/MembershipReviewService.js',
  'utf8'
);
const ui=fs.readFileSync(
  'src/interfaces/discord/interactions/membership.js',
  'utf8'
);
const migration=fs.readFileSync(
  'migrations/111_membership_campaign_dm_delivery.sql',
  'utf8'
);

function body(source,startMark,endMark){
  const start=source.indexOf(startMark);
  assert.ok(start>=0,`missing ${startMark}`);
  const end=source.indexOf(endMark,start+startMark.length);
  assert.ok(end>start,`missing ${endMark}`);
  return source.slice(start,end);
}

test('admin publish sends the campaign privately',()=>{
  const b=body(
    service,
    'async publish({ guild, channel, actorId, actorMember = null })',
    'async response({ guild, interaction, campaignId, choice })'
  );

  assert.match(b,/operationalDmDeliveryEnabled/);
  assert.match(b,/member\.send\(\{/);
  assert.doesNotMatch(b,/await channel\.send/);
  assert.match(b,/membership:choice:continue:/);
  assert.match(b,/membership:freeze:/);
  assert.match(b,/membership:choice:withdraw:/);
});

test('private delivery is persisted per campaign member',()=>{
  const b=body(
    service,
    'async publish({ guild, channel, actorId, actorMember = null })',
    'async response({ guild, interaction, campaignId, choice })'
  );

  assert.match(b,/dm_status/);
  assert.match(b,/dm_sent_at/);
  assert.match(b,/dm_error/);
});

test('campaign snapshots include team and support membership',()=>{
  const b=body(
    service,
    'async publish({ guild, channel, actorId, actorMember = null })',
    'async response({ guild, interaction, campaignId, choice })'
  );

  assert.match(b,/support_role_ids/);
  assert.match(b,/support_role_names/);
  assert.match(b,/memberSupportRoles/);
});

test('continue restores support membership',()=>{
  assert.match(
    service,
    /async applyContinue[\s\S]*?supportIds[\s\S]*?safeRoleAdd\(member,item\.support\.id\)/
  );
});

test('withdraw removes support membership',()=>{
  assert.match(
    service,
    /async applyWithdraw[\s\S]*?supportRoles\(guild\)[\s\S]*?safeRoleRemove\(member,item\.support\.id\)/
  );
});

test('freeze and scheduled return preserve support membership',()=>{
  assert.match(service,/supportRoleSnapshot/);
  assert.match(
    service,
    /async applyFreeze[\s\S]*?supportRoleIds[\s\S]*?supportRoleNames/
  );
  assert.match(
    service,
    /async processReturns[\s\S]*?supportSnap[\s\S]*?safeRoleAdd\(member,item\.support\.id\)/
  );
});

test('membership role settings self-heal from canonical role names',()=>{
  assert.match(service,/normalizeRoleName\('الموارد البشرية'\)/);
  assert.match(service,/normalizeRoleName\('عضوية عامة'\)/);
  assert.match(service,/membership_role_id=COALESCE/);
  assert.match(service,/hr_role_id=COALESCE/);
});

test('DM delivery can be blocked explicitly instead of falling back to public channel',()=>{
  assert.match(service,/MEMBERSHIP_DM_DISABLED/);
  assert.match(service,/if\(!dmEnabled\)/);
});

test('final membership UI reports DM delivery counts',()=>{
  const b=body(
    ui,
    'async function publish(i,a,s){',
    'async function status(i,a,s){'
  );

  assert.match(b,/result\.dmSent/);
  assert.match(b,/result\.dmFailed/);
  assert.match(b,/result\.totalMembers/);
});

test('migration has durable DM delivery fields',()=>{
  assert.match(migration,/dm_status text NOT NULL DEFAULT 'pending'/);
  assert.match(migration,/dm_sent_at timestamptz/);
  assert.match(migration,/dm_error text/);
  assert.match(
    migration,
    /dm_status IN \('pending','sent','failed'\)/
  );
});
