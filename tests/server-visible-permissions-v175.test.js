import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const definitions = fs.readFileSync(new URL('../src/infrastructure/discord/commandDefinitions.js', import.meta.url), 'utf8');
const commandNames = [...definitions.matchAll(/\.setName\('([^']+)'\)/g)].map((match) => match[1]);

test('panel is available in the guild and approved bot DMs', () => {
  assert.deepEqual(commandNames, ['panel', 'setup', 'health']);
  const panelBlock = definitions.slice(definitions.indexOf('const panel'), definitions.indexOf('const setup'));
  assert.match(panelBlock, /حسب صلاحياتك/);
  assert.match(panelBlock, /InteractionContextType\.Guild/);
  assert.match(panelBlock, /InteractionContextType\.BotDM/);
  assert.doesNotMatch(panelBlock, /setDefaultMemberPermissions/);
});

test('technical commands keep Discord administrator visibility plus runtime protection', () => {
  const setupBlock = definitions.slice(definitions.indexOf('const setup'), definitions.indexOf('const health'));
  const healthBlock = definitions.slice(definitions.indexOf('const health'), definitions.indexOf('export const commandBuilders'));
  for (const block of [setupBlock, healthBlock]) {
    assert.match(block, /setDefaultMemberPermissions\(PermissionFlagsBits\.Administrator\)/);
    assert.match(block, /InteractionContextType\.Guild/);
    assert.match(block, /InteractionContextType\.BotDM/);
  }
  const setup = fs.readFileSync(new URL('../src/interfaces/discord/commands/setup.js', import.meta.url), 'utf8');
  const health = fs.readFileSync(new URL('../src/interfaces/discord/commands/health.js', import.meta.url), 'utf8');
  assert.match(setup, /OWNER_USER_ID/);
  assert.match(health, /isOwner/);
  assert.match(health, /isSuperAdmin/);
  assert.match(health, /FORBIDDEN/);
});

test('deployment publishes guild commands before global DM-capable commands', () => {
  const source = fs.readFileSync(new URL('../scripts/deploy.js', import.meta.url), 'utf8');
  const guildIndex = source.indexOf('rest.put(guildRoute');
  const globalIndex = source.indexOf('rest.put(globalRoute');
  assert.ok(guildIndex >= 0, 'guild deployment is required');
  assert.ok(globalIndex > guildIndex, 'global deployment must happen after guild deployment');
  assert.match(source, /Routes\.applicationGuildCommands/);
  assert.match(source, /Routes\.applicationCommands/);
});

test('panel stays private and filters administrative sections by bot permissions', () => {
  const panel = fs.readFileSync(new URL('../src/interfaces/discord/commands/panel.js', import.meta.url), 'utf8');
  assert.match(panel, /hasAnyPotential/);
  assert.match(panel, /isOwner/);
  assert.match(panel, /isSuperAdmin/);
  assert.match(panel, /ephemeral:Boolean\(interaction\.guildId\)/);
  assert.match(panel, /لوحة العضو/);
  assert.match(panel, /لوحة المسؤول/);
});

test('runtime rejects wrong guilds and protects DMs by configured guild membership', () => {
  const router = fs.readFileSync(new URL('../src/interfaces/discord/router.js', import.meta.url), 'utf8');
  assert.match(router, /WRONG_GUILD/);
  assert.match(router, /rawInteraction\.guildId/);
  assert.match(router, /app\.env\.GUILD_ID/);
  assert.match(router, /production-dm:server-member-access/);
  assert.match(router, /guild\.members\.fetch/);
  assert.match(router, /DM_PRIVATE/);
  assert.doesNotMatch(router, /permissionService\.canUseDm/);
});
