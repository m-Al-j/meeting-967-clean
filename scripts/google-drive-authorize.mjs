import 'dotenv/config';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';

const CLIENT_FILE = String(
  process.env.GOOGLE_DRIVE_OAUTH_CLIENT_FILE ??
  './config/google-drive-oauth-client.json'
).trim();

const TOKEN_FILE = String(
  process.env.GOOGLE_DRIVE_OAUTH_TOKEN_FILE ??
  './config/google-drive-oauth-token.json'
).trim();

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function credentialsFrom(json) {
  const c = json?.installed ?? json?.web ?? json ?? {};
  return {
    clientId: String(c.client_id ?? '').trim(),
    clientSecret: String(c.client_secret ?? '').trim(),
  };
}

async function main() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(CLIENT_FILE, 'utf8'));
  } catch {
    throw new Error(
      'لم أجد ملف OAuth Client:\n' + CLIENT_FILE +
      '\nضع ملف JSON الذي نزلته من Google Cloud في هذا المسار.'
    );
  }

  const { clientId, clientSecret } = credentialsFrom(raw);
  if (!clientId) throw new Error('client_id غير موجود في ملف OAuth.');

  await fs.mkdir(new URL('../config/', import.meta.url).pathname, { recursive: true }).catch(() => {});
  await fs.mkdir(TOKEN_FILE.split('/').slice(0, -1).join('/') || '.', { recursive: true });

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('تعذر فتح منفذ OAuth محلي.');

  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret || undefined, redirectUri);

  const state = crypto.randomUUID();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  console.log('');
  console.log('============================================================');
  console.log(' Google Drive — تفويض حسابك');
  console.log('============================================================');
  console.log('سيُفتح Google في المتصفح. اختر الحساب الذي تريد حفظ التسجيلات فيه.');
  console.log('إذا لم يفتح المتصفح، انسخ هذا الرابط وافتحه يدويًا:');
  console.log('');
  console.log(authUrl);
  console.log('');

  try {
    if (fssync.existsSync('/data/data/com.termux/files/usr/bin/termux-open-url')) {
      spawn('termux-open-url', [authUrl], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {}

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('انتهت مهلة التفويض. شغّل الأمر مرة ثانية.'));
    }, 10 * 60_000);

    server.on('request', (req, res) => {
      try {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid OAuth state');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          clearTimeout(timeout);
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Google authorization was denied. Return to Termux.');
          reject(new Error('Google رفض التفويض: ' + error));
          return;
        }
        const value = url.searchParams.get('code');
        if (!value) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Missing authorization code');
          return;
        }
        clearTimeout(timeout);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8"><h2>تم ربط Google Drive بنجاح ✅</h2><p>ارجع الآن إلى Termux.</p>');
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
  }).finally(() => server.close());

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google لم يُرجع refresh_token. احذف وصول Meeting 967 من حساب Google ثم أعد التفويض.'
    );
  }

  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
  console.log('✅ تم حفظ تفويض Google Drive محليًا.');
  console.log('🔐 Token:', TOKEN_FILE);
  console.log('الآن شغّل: npm run verify:google-drive');
}

main().catch((error) => {
  console.error('❌', error?.message ?? error);
  process.exit(1);
});
