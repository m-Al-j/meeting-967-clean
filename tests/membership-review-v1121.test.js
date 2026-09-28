import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(
  'src/interfaces/discord/interactions/membership.js',
  'utf8'
);

test('membership publish does not reject a resolved guild only because guildId is absent', () => {
  const start = ui.indexOf('async function publish(i,a,s){');
  const end = ui.indexOf('async function status(i,a,s){', start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const block = ui.slice(start, end);

  assert.match(block, /i\.channel\?\.isDMBased\?\.\(\)/);
  assert.doesNotMatch(
    block,
    /if\(!i\.guildId\)\s*\{\s*throw new AppError\(\s*'BAD_CHANNEL'/
  );
  assert.match(block, /يجب تنفيذ نشر حملة العضويات من داخل السيرفر/);
});

test('membership publish still explicitly rejects direct-message channels', () => {
  const start = ui.indexOf('async function publish(i,a,s){');
  const end = ui.indexOf('async function status(i,a,s){', start);
  const block = ui.slice(start, end);

  assert.match(block, /isDirectMessage/);
  assert.match(block, /i\.channel\?\.isDMBased/);
  assert.match(block, /i\.channel\?\.type === 1/);
});
