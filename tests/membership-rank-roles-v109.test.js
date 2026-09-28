import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(
  'src/application/services/PointsService.js',
  'utf8'
);
const index=fs.readFileSync(
  'src/index.js',
  'utf8'
);

test('requested level labels are correct',()=>{
  assert.match(service,/label: 'عضو جديد'/);
  assert.match(service,/label: 'مشارك'/);
  assert.match(service,/label: 'عضو متفاعل'/);
  assert.match(service,/label: 'عضو فاعل'/);
  assert.match(service,/label: 'عضو متميز'/);
  assert.doesNotMatch(service,/label: 'مساهم'/);
});

test('level roles and weekly role are configured',()=>{
  assert.match(service,/emoji: '🌱'/);
  assert.match(service,/emoji: '🔹'/);
  assert.match(service,/emoji: '⚡'/);
  assert.match(service,/emoji: '⭐'/);
  assert.match(service,/emoji: '👑'/);
  assert.match(service,/name: '🏆 عضو الأسبوع'/);
  assert.match(service,/roleColor: 0x7F8C8D/);
  assert.match(service,/roleColor: 0x3498DB/);
  assert.match(service,/roleColor: 0x2ECC71/);
  assert.match(service,/roleColor: 0xE67E22/);
  assert.match(service,/roleColor: 0x9B59B6/);
  assert.match(service,/color: 0xD4AF37/);
});

test('rank sync is started after Discord is ready',()=>{
  assert.match(
    index,
    /app\.pointsService\?\.startDiscordRoleSync\?\.\(guild\);/
  );
});

test('rank sync and weekly rotation logic exist',()=>{
  assert.match(service,/async syncDiscordRoles\(guild\)/);
  assert.match(service,/Meeting 967 — Membership level update/);
  assert.match(service,/Meeting 967 — Weekly member rotation/);
  assert.match(service,/ORDER BY points DESC, MIN\(created_at\) ASC, user_id ASC/);
});
