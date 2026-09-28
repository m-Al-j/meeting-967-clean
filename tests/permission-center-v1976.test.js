import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_METADATA,
  permissionMeta,
  permissionsInCategory,
  SUPER_ADMIN_PERMISSION,
  DM_TRIAL_PERMISSION
} from '../src/core/permissions/catalog.js';

test('every normal permission has Arabic metadata',()=>{
  assert.equal(PERMISSIONS.length,35);
  for(const key of PERMISSIONS){
    const meta=permissionMeta(key);
    assert.ok(meta.label && meta.label!==key,`missing Arabic label for ${key}`);
    assert.ok(meta.description?.length>=12,`missing description for ${key}`);
    assert.ok(PERMISSION_CATEGORIES[meta.category],`invalid category for ${key}`);
    assert.ok(meta.risk,`missing risk for ${key}`);
  }
});

test('permission categories fit Discord select limits',()=>{
  assert.ok(Object.keys(PERMISSION_CATEGORIES).length<=25);
  const seen=new Set();
  for(const category of Object.keys(PERMISSION_CATEGORIES)){
    const keys=permissionsInCategory(category);
    assert.ok(keys.length>0,`empty category ${category}`);
    assert.ok(keys.length<=25,`category ${category} exceeds Discord limit`);
    for(const key of keys){assert.ok(!seen.has(key),`duplicate ${key}`);seen.add(key);}
  }
  assert.equal(seen.size,PERMISSIONS.length);
});

test('special permissions have documented Arabic metadata',()=>{
  for(const key of [SUPER_ADMIN_PERMISSION,DM_TRIAL_PERMISSION]){
    assert.ok(PERMISSION_METADATA[key]?.label);
    assert.ok(PERMISSION_METADATA[key]?.description);
  }
});

test('permissions center routes and Arabic management views exist',()=>{
  const src=fs.readFileSync(new URL('../src/interfaces/discord/interactions/permissions.js',import.meta.url),'utf8');
  for(const token of [
    "perm:catalog",
    "perm:catalog-category",
    "perm:inspect-user",
    "perm:inspect-grant",
    "perm:inspect-revoke",
    "perm:inspect-deny",
    "perm:deny-user",
    "perm:deny-role",
    "perm:deny-team",
    "perm:revoke-page:",
    "perm:permission-category",
    "دليل الصلاحيات",
    "فحص صلاحيات عضو",
    "مركز الصلاحيات"
  ]) assert.ok(src.includes(token),`missing ${token}`);
  assert.ok(src.indexOf("id==='perm:subject:inspect'") < src.indexOf("id.startsWith('perm:subject:')"),'specific inspect route must run before generic subject route');
  assert.ok(src.includes('permissionLabel(g.permission_key)'),'revoke UI should use Arabic permission labels');
  assert.ok(src.includes("effect=d.effect==='deny'?'deny':'allow'"),'grant flow must support explicit deny records');
  assert.ok(src.includes('const pageSize=20'),'revoke flow must paginate beyond Discord 25-option select limit');
});
