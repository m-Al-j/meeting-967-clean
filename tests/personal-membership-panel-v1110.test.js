import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(
  new URL('../src/interfaces/discord/commands/panel.js', import.meta.url),
  'utf8'
);

test('final dashboard renderer exposes personal membership management', () => {
  const start = panel.indexOf("async function buildPanelClearV1106(interaction,app){");
  const end = panel.indexOf("// clear-adaptive-dashboard-v1.10.6:end", start);

  assert.ok(start >= 0, 'buildPanelClearV1106 missing');
  assert.ok(end > start, 'buildPanelClearV1106 end marker missing');

  const block = panel.slice(start, end);

  assert.match(block, /add\(true,'member:membership','إدارة عضويتي','🪪'\);/);
});

test('membership button is not only defined in the legacy MEMBER_BUTTONS array', () => {
  const start = panel.indexOf("async function buildPanelClearV1106(interaction,app){");
  const end = panel.indexOf("// clear-adaptive-dashboard-v1.10.6:end", start);
  const block = panel.slice(start, end);

  const matches = block.match(/member:membership/g) ?? [];
  assert.ok(matches.length >= 1, 'final renderer does not contain member:membership');
});

test('dashboard button keeps Discord renderer ceiling intact', () => {
  assert.match(panel, /visible=v1106Unique\(buttons\)\.slice\(0,25\)/);
  assert.match(panel, /function v1106Rows\(buttons\)/);
});
