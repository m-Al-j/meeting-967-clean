
import '../src/config/env.js';
import { pool } from '../src/infrastructure/db/pool.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const RECORDING_ID = '36b5a83b-2bc4-448c-b5e3-b0d24c70a142';
const OUT_DIR = path.resolve('storage/recovered-single-recording');
const OUT = path.join(OUT_DIR, 'meeting-47e617e8-recovered-timeline-v2.ogg');

const CHUNK_MS = 10000;

fs.mkdirSync(OUT_DIR, { recursive: true });

const db = await pool.query(`
  SELECT started_at, stopped_at
  FROM recordings
  WHERE id = $1
`, [RECORDING_ID]);

if (!db.rows.length) throw new Error('Recording not found');

const recordingStart = new Date(db.rows[0].started_at).getTime();
const recordingEnd = new Date(db.rows[0].stopped_at).getTime();

const q = await pool.query(`
  SELECT path, started_at, ended_at
  FROM recording_tracks
  WHERE recording_id = $1
  ORDER BY started_at
`, [RECORDING_ID]);

const tracks = q.rows.map(t => ({
  path: t.path,
  start: new Date(t.started_at).getTime(),
  end: new Date(t.ended_at).getTime()
}));

if (fs.existsSync(OUT)) {
  throw new Error(`Output already exists: ${OUT}`);
}

console.log('');
console.log('============================================');
console.log('  967 SINGLE RECORDING RECOVERY');
console.log('============================================');
console.log(`Tracks : ${tracks.length}`);
console.log(`Start  : ${new Date(recordingStart).toISOString()}`);
console.log(`End    : ${new Date(recordingEnd).toISOString()}`);
console.log(`Output : ${OUT}`);
console.log('============================================');
console.log('');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let err = '';

    p.stderr.on('data', d => {
      err += d.toString();
    });

    p.on('error', reject);

    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}\n${err.slice(-4000)}`));
    });
  });
}

const encoder = spawn('ffmpeg', [
  '-hide_banner',
  '-loglevel', 'warning',
  '-f', 's16le',
  '-ar', '48000',
  '-ac', '2',
  '-i', 'pipe:0',
  '-c:a', 'libopus',
  '-b:a', '128k',
  '-vbr', 'on',
  '-application', 'audio',
  '-y',
  OUT
], {
  stdio: ['pipe', 'ignore', 'pipe']
});

let encoderError = '';

encoder.stderr.on('data', d => {
  encoderError += d.toString();
});

const encoderDone = new Promise((resolve, reject) => {
  encoder.on('error', reject);

  encoder.on('close', code => {
    if (code === 0) resolve();
    else reject(new Error(
      `encoder failed ${code}\n${encoderError.slice(-4000)}`
    ));
  });
});

let chunkStart = recordingStart;
let chunkNo = 0;

try {
  while (chunkStart < recordingEnd) {
    const chunkEnd = Math.min(
      chunkStart + CHUNK_MS,
      recordingEnd
    );

    const active = tracks.filter(t =>
      t.start < chunkEnd && t.end > chunkStart
    );

    const duration =
      (chunkEnd - chunkStart) / 1000;

    const args = [
      '-hide_banner',
      '-loglevel', 'error'
    ];

    const filters = [];

    if (!active.length) {
      args.push(
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', duration.toFixed(6),
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      );
    } else {
      active.forEach((t, i) => {
        args.push('-i', t.path);

        const trimStart =
          Math.max(0, (chunkStart - t.start) / 1000);

        const trimEnd =
          Math.min(
            (t.end - t.start) / 1000,
            (chunkEnd - t.start) / 1000
          );

        const delay =
          Math.max(0, Math.round(
            (t.start - chunkStart)
          ));

        filters.push(
          `[${i}:a]` +
          `atrim=start=${trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)},` +
          `asetpts=PTS-STARTPTS,` +
          `adelay=${delay}|${delay}` +
          `[a${i}]`
        );
      });

      const labels =
        active.map((_, i) => `[a${i}]`).join('');

      filters.push(
        `${labels}` +
        `amix=inputs=${active.length}:duration=longest:` +
        `dropout_transition=0:normalize=0,` +
        `alimiter=limit=0.95:attack=5:release=50,apad,` +
        `atrim=duration=${duration.toFixed(6)},` +
        `asetpts=PTS-STARTPTS[out]`
      );

      args.push(
        '-filter_complex',
        filters.join(';'),
        '-map', '[out]',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      );
    }

    const chunk = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let chunkError = '';

    chunk.stderr.on('data', d => {
      chunkError += d.toString();
    });

    chunk.stdout.on('data', d => {
      if (!encoder.stdin.write(d)) {
        chunk.stdout.pause();
        encoder.stdin.once('drain', () => {
          chunk.stdout.resume();
        });
      }
    });

    await new Promise((resolve, reject) => {
      chunk.on('error', reject);

      chunk.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(
          `chunk ${chunkNo + 1} failed ${code}\n${chunkError.slice(-4000)}`
        ));
      });
    });

    chunkNo++;

    const percent =
      ((chunkEnd - recordingStart) /
      (recordingEnd - recordingStart)) * 100;

    process.stdout.write(
      `\rChunk ${chunkNo} | ${percent.toFixed(1)}% | active ${active.length}`
    );

    chunkStart = chunkEnd;
  }

  encoder.stdin.end();
  await encoderDone;

  const stat = fs.statSync(OUT);

  console.log('');
  console.log('');
  console.log('============================================');
  console.log('  RECOVERY COMPLETE');
  console.log('============================================');
  console.log(`Chunks : ${chunkNo}`);
  console.log(`Tracks : ${tracks.length}`);
  console.log(`Bytes  : ${stat.size}`);
  console.log(`File   : ${OUT}`);
  console.log('============================================');

} catch (e) {
  try {
    encoder.stdin.destroy();
    encoder.kill('SIGKILL');
  } catch {}

  try {
    if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  } catch {}

  console.error('');
  console.error('RECOVERY FAILED');
  console.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
