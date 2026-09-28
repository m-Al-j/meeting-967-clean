import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) =>
  fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const esc = (s) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('membership review migration is additive and complete', () => {
  const s = read('migrations/107_membership_review.sql');
  const upgrade = read('migrations/108_membership_team_role_snapshot.sql');
  const personal = read('migrations/109_membership_personal_management.sql');

  for (const token of [
    'membership_settings',
    'membership_review_campaigns',
    'membership_campaign_members',
    'membership_reviews',
    "choice TEXT NOT NULL CHECK (choice IN ('continue','freeze','withdraw'))",
    'deadline_at',
    'report_file_path',
  ]) {
    assert.match(s, new RegExp(esc(token)));
  }

  for (const token of [
    'team_role_ids',
    'team_role_names',
    'ADD COLUMN IF NOT EXISTS',
  ]) {
    assert.match(upgrade, new RegExp(esc(token)));
  }

  for (const token of [
    'membership_support_roles',
    'membership_personal_states',
    'support_role_ids',
    'support_role_names',
    'pre_freeze_snapshot',
    'post_freeze_snapshot',
  ]) {
    assert.match(personal, new RegExp(esc(token)));
  }

  assert.doesNotMatch(s, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test('membership lifecycle and five-day report exist', () => {
  const s = read('src/application/services/MembershipReviewService.js');

  for (const token of [
    '5*24*60*60*1000',
    'applyContinue',
    'applyWithdraw',
    'applyFreeze',
    'processScheduledFreezes',
    'processReturns',
    'processPersonalReturns',
    'generateReport',
    'closeExpiredCampaigns',
    'الموارد البشرية',
    'الفريق الإعلامي',
    'الفريق التنفيذي',
    'التقنية والبحث',
    'الاداره والحوكمة',
    'requireTeamRoles',
    'removeTeamRoles',
    'restoreTeamRoles',
  ]) {
    assert.match(s, new RegExp(esc(token)));
  }

  assert.match(s, /teamRoleIds/);
  assert.match(s, /teamRoleNames/);
});

test('personal membership management is implemented', () => {
  const ui = read('src/interfaces/discord/interactions/membership.js');
  const service = read('src/application/services/MembershipReviewService.js');

  for (const token of [
    'member:membership',
    'member:membership:freeze',
    'member:membership:freeze-submit',
    'member:membership:support',
    'member:membership:support-submit',
    'personalHome',
    'personalFreezeOpen',
    'personalFreezeSubmit',
    'personalSupportOpen',
    'personalSupportSubmit',
    'StringSelectMenuBuilder',
    'تجميد عضويتي',
    'إدارة الفريق المساند',
    'تاريخ العودة',
    'سبب التجميد',
  ]) {
    assert.match(ui, new RegExp(esc(token)));
  }

  for (const token of [
    'personalState',
    'personalMembership',
    'freezePersonal',
    'setSupportMembership',
    'clearSupportMembership',
    'processPersonalReturns',
    'membership_personal_states',
    'membership_support_roles',
    'snapshot',
    'support_role_ids',
  ]) {
    assert.match(service, new RegExp(esc(token)));
  }

  assert.doesNotMatch(
    ui,
    /membership:config:general|membership:config:hr/
  );
});

test('membership is routed and freeze is a true modal opener', () => {
  const r = read('src/interfaces/discord/interactionReliability.js');
  const d = read('src/interfaces/discord/componentDispatcher.js');
  const ui = read('src/interfaces/discord/interactions/membership.js');

  assert.match(r, /member:membership/);
  assert.match(r, /membership:freeze/);
  assert.match(r, /id==='admin:membership'/);

  assert.match(d, /handleMembership/);
  assert.match(d, /membership:handleMembership/);

  assert.match(ui, /showModal/);
  assert.match(ui, /member:membership:freeze-submit/);
});

test('panel exposes membership management through the membership service', () => {
  const p = read('src/interfaces/discord/commands/panel.js');

  assert.match(p, /admin:membership/);
  assert.match(p, /member:membership/);
  assert.match(p, /membershipReviewService/);
  assert.match(p, /membershipManager/);
  assert.match(p, /إدارة عضويتي/);
});

test('app and runtime wire the membership lifecycle service', () => {
  const app = read('src/app.js');
  const index = read('src/index.js');

  assert.match(app, /MembershipReviewService/);
  assert.match(app, /membershipReviewService/);
  assert.match(index, /membershipReviewService\?\.start/);
  assert.match(index, /membershipReviewService\?\.stop/);
});
