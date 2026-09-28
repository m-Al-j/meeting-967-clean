import 'dotenv/config';
import fs from 'node:fs/promises';
import { google } from 'googleapis';

const clientFile = String(
  process.env.GOOGLE_DRIVE_OAUTH_CLIENT_FILE ??
  './config/google-drive-oauth-client.json'
).trim();
const tokenFile = String(
  process.env.GOOGLE_DRIVE_OAUTH_TOKEN_FILE ??
  './config/google-drive-oauth-token.json'
).trim();
const rootFolderName = String(
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME ??
  'Meeting 967'
).trim() || 'Meeting 967';

function escapeQ(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const clientJson = JSON.parse(await fs.readFile(clientFile, 'utf8'));
const tokenJson = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
const c = clientJson.installed ?? clientJson.web ?? clientJson;
const clientId = String(c.client_id ?? '').trim();
const clientSecret = String(c.client_secret ?? '').trim();
if (!clientId) throw new Error('client_id غير موجود.');

const auth = new google.auth.OAuth2(clientId, clientSecret || undefined);
auth.setCredentials(tokenJson);
const drive = google.drive({ version: 'v3', auth });

const about = await drive.about.get({ fields: 'user(displayName,emailAddress),storageQuota(limit,usage)' });

const q = `'root' in parents and name='${escapeQ(rootFolderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
const listed = await drive.files.list({
  q,
  fields: 'files(id,name,webViewLink)',
  spaces: 'drive',
  pageSize: 10,
});

let folder = listed.data.files?.[0] ?? null;
if (!folder) {
  const created = await drive.files.create({
    requestBody: {
      name: rootFolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
      appProperties: { meeting967Type: 'root', meeting967Product: 'Meeting967' },
    },
    fields: 'id,name,webViewLink',
  });
  folder = created.data;
}

console.log('✅ Google Drive جاهز.');
console.log('👤 الحساب:', about.data.user?.emailAddress || about.data.user?.displayName || 'غير معروف');
console.log('📁 المجلد:', folder.name, '(' + folder.id + ')');
console.log('🔗 الرابط:', folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`);
console.log('💾 المصادقة: OAuth باسم حساب Google — ليست Service Account');
