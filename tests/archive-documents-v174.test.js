import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArchiveDocumentService, ARCHIVE_DOCUMENT_SECTIONS } from '../src/application/services/ArchiveDocumentService.js';

class FakeDb {
  constructor() { this.inserts = []; }

  async query(sql, params = []) {
    if (sql.includes('SELECT timezone FROM settings')) return { rows: [{ timezone: 'Asia/Riyadh' }] };
    if (sql.includes('INSERT INTO archive_documents')) {
      this.inserts.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('FROM members m JOIN users u') && sql.includes('m.user_id=$2')) {
      return { rows: [{ id: '123', member_name: 'عضو تجريبي', username: 'member_967', active: true, joined_at: new Date('2026-08-01T12:00:00Z'), teams: 'فريق التقنية' }] };
    }
    if (sql.includes('FROM members m JOIN users u')) {
      return { rows: [
        { id: '123', member_name: 'عضو تجريبي', username: 'member_967', active: true, joined_at: new Date('2026-08-01T12:00:00Z'), teams: 'فريق التقنية' },
        { id: '456', member_name: 'عضو ثانٍ', username: 'member_two', active: true, joined_at: new Date('2026-08-02T12:00:00Z'), teams: 'فريق الإعلام' },
      ] };
    }
    return { rows: [] };
  }
}

test('section catalog includes every supported archive area', () => {
  for (const key of ['members', 'meetings', 'attendance', 'excuses', 'recordings', 'reports', 'tasks', 'operations', 'audit', 'backups']) {
    assert.ok(ARCHIVE_DOCUMENT_SECTIONS[key], `missing ${key}`);
  }
});

test('generates a branded Arabic Word document and registers it', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting967-archive-docs-'));
  const db = new FakeDb();
  const service = new ArchiveDocumentService({ db, env: { STORAGE_DIR: storage } });
  const result = await service.generateSection({ guildId: '967', sectionKey: 'members', actorId: '1' });
  const bytes = await fs.readFile(result.file);
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK');
  assert.match(result.fileName, /سجلات الأعضاء/);
  assert.equal(result.rowCount, 2);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0].params[2], 'members');
  assert.ok(result.bytes > 1000);
});

test('generates a complete bundle with a separate Word file for every section', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting967-archive-bundle-'));
  const db = new FakeDb();
  const service = new ArchiveDocumentService({ db, env: { STORAGE_DIR: storage } });
  const result = await service.generateAll({ guildId: '967', actorId: '1' });
  assert.equal(result.documents.length, Object.keys(ARCHIVE_DOCUMENT_SECTIONS).length);
  assert.equal((await fs.readFile(result.index.file)).subarray(0, 2).toString('ascii'), 'PK');
  assert.deepEqual([...((await fs.readFile(result.bundle)).subarray(0, 2))], [0x1f, 0x8b]);
  assert.ok(result.bytes > 1000);
});
