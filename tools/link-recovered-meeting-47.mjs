
import '../src/config/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/infrastructure/db/pool.js';
import { RecordingRepository } from '../src/infrastructure/repositories/RecordingRepository.js';

const meetingId = '47e617e8-3b42-4377-a913-21085ff4c13e';
const source = path.resolve(
  'storage/recovered-single-recording/meeting-47e617e8-recovered-timeline-v4.ogg'
);

const targetRecordingId = 'd9d1ec6c-65d2-4294-a17d-8bb664fe9c06';
const recoveredFromRecordingId = '36b5a83b-2bc4-448c-b5e3-b0d24c70a142';

const repo = new RecordingRepository(pool);

try {
  console.log('========== RECOVERY LINK ==========');

  const sourceStat = await fs.stat(source);

  if (sourceStat.isFile() !== true || sourceStat.size < 100000) {
    throw new Error(`Recovery file is missing or invalid: ${source}`);
  }

  console.log(`Source OK : ${source}`);
  console.log(`Source MB : ${(sourceStat.size / 1024 / 1024).toFixed(2)}`);

  const { rows } = await pool.query(
    `SELECT id, meeting_id, storage_path, final_paths, final_bytes,
            status, session_index, metadata
       FROM recordings
      WHERE meeting_id=$1
      ORDER BY session_index ASC`,
    [meetingId]
  );

  console.log(`Sessions  : ${rows.length}`);

  const target = rows.find(
    r => String(r.id) === targetRecordingId
  );

  if (target === undefined) {
    throw new Error(`Target recording not found: ${targetRecordingId}`);
  }

  console.log(`Target OK : ${target.id}`);
  console.log(`Status    : ${target.status}`);
  console.log(`Session   : ${target.session_index}`);

  const backupPath = path.resolve(
    `storage/recovered-single-recording/meeting-${meetingId}-db-backup.json`
  );

  await fs.writeFile(
    backupPath,
    JSON.stringify(rows, null, 2),
    'utf8'
  );

  console.log(`Backup    : ${backupPath}`);

  const targetDir = target.storage_path;

  if (targetDir === null || targetDir === undefined || targetDir === '') {
    throw new Error('Target recording has no storage_path');
  }

  await fs.mkdir(targetDir, { recursive: true });

  const finalPath = path.join(
    targetDir,
    `meeting-${meetingId}-recovered-final.ogg`
  );

  await fs.copyFile(source, finalPath);

  const finalStat = await fs.stat(finalPath);

  if (finalStat.size !== sourceStat.size) {
    throw new Error(
      `Copy verification failed: source=${sourceStat.size}, target=${finalStat.size}`
    );
  }

  console.log(`Final OK  : ${finalPath}`);
  console.log(`Final MB  : ${(finalStat.size / 1024 / 1024).toFixed(2)}`);

  await repo.setFinalFiles(
    targetRecordingId,
    [finalPath],
    {
      finalScope: 'meeting-timeline',
      finalMixVersion: 'manual-recovery-v1',
      includesRecoveryRows: true,
      manualRecovery: true,

      recoveredFromRecordingId,
      recoverySource: path.basename(source),

      integrityGuardVersion: '1.10.11',
      integrityStatus: 'needs_recovery',
      integrityCompromised: true,

      integrityReasons: [
        'receiver-integrity-compromised',
        'voice-nonready-gap-too-large',
        'recorder-timeline-gap-too-large',
        'manual-recovery-file-linked'
      ],

      integrityMaxGapMs: 65424,
      integrityCoverageRatio: 0.9869359570821894,

      recoveryNote:
        'Manual recovery from 1160 existing recording tracks. ' +
        'The real interruption/gap was preserved as silence; ' +
        'missing audio was not reconstructed.'
    }
  );

  const verify = await pool.query(
    `SELECT id, status, session_index, final_paths, final_bytes, metadata
       FROM recordings
      WHERE id=$1`,
    [targetRecordingId]
  );

  const row = verify.rows[0];

  console.log('');
  console.log('========== LINK COMPLETE ==========');
  console.log(`Recording : ${row.id}`);
  console.log(`Status    : ${row.status}`);
  console.log(`Session   : ${row.session_index}`);
  console.log(`Final     : ${JSON.stringify(row.final_paths)}`);
  console.log(`FinalBytes: ${row.final_bytes}`);
  console.log(`Integrity : ${row.metadata?.integrityStatus}`);
  console.log(`Mix       : ${row.metadata?.finalMixVersion}`);
  console.log(`Recovered : ${row.metadata?.manualRecovery}`);
  console.log(`FILE      : ${row.final_paths?.[0]}`);
  console.log('===================================');

} catch (error) {
  console.error('');
  console.error('RECOVERY LINK FAILED');
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
