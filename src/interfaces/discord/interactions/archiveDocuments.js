import fs from 'node:fs/promises';
import path from 'node:path';
import { ButtonStyle } from 'discord.js';
import { e, btn, rowsFromButtons, stringSelect, withNavigation } from '../ui.js';
import { subjectFromInteraction } from '../context.js';
import { AppError } from '../../../core/errors/AppError.js';
import {
  ArchiveDocumentService,
  ARCHIVE_DOCUMENT_SECTIONS,
  ARCHIVE_DOCUMENT_SECTION_ORDER,
} from '../../../application/services/ArchiveDocumentService.js';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const PAGE_SIZE = 20;

function bytes(value) {
  let n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (n >= 1024 && index < units.length - 1) { n /= 1024; index += 1; }
  return `${n.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function iso(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
}

async function ownerSubject(interaction, app) {
  const subject = await subjectFromInteraction(interaction, app.env);
  if (!app.permissionService.isOwner(subject.userId)) {
    throw new AppError('OWNER_ONLY', 'أرشيف المستندات الرسمية متاح للـOwner فقط.');
  }
  return subject;
}

function service(app) {
  if (!app.__archiveDocumentService) {
    app.__archiveDocumentService = new ArchiveDocumentService({
      db: app.db,
      env: app.env,
      audit: app.audit,
      logger: app.logger,
    });
  }
  return app.__archiveDocumentService;
}

function sectionOptions() {
  return ARCHIVE_DOCUMENT_SECTION_ORDER.map((key) => ({
    label: ARCHIVE_DOCUMENT_SECTIONS[key].label.slice(0, 100),
    description: ARCHIVE_DOCUMENT_SECTIONS[key].description.slice(0, 100),
    value: key,
  }));
}

async function home(interaction) {
  const text = [
    '**ماذا تفعل هذه الإضافة؟**',
    '• تنشئ لكل قسم ملف Word مستقلًا ومنظمًا.',
    '• تضع شعار 967 الدائري في أعلى كل ملف دون إطار أسود خارجي.',
    '• تضيف التاريخ والوقت والرقم المرجعي وعدد السجلات وبصمة التحقق.',
    '• تحفظ الملفات داخل مجلدات مرتبة حسب السنة والشهر والقسم.',
    '• تبقي التسجيل الصوتي ملفًا صوتيًا مستقلًا، وتولد له فهرس Word رسميًا.',
    '',
    '> الملفات البشرية تكون Word. ملفات الاسترجاع والفهارس التقنية تبقى بصيغتها الآلية مع وجود مستند Word مرافق.',
  ].join('\n');
  const components = [
    stringSelect('archive-docs:section', 'اختر القسم المراد إنشاء ملفه', sectionOptions()),
    ...rowsFromButtons([
      btn('archive-docs:full', 'إنشاء الحزمة الكاملة', ButtonStyle.Primary, '📚'),
      btn('archive-docs:history:0', 'الملفات المحفوظة', ButtonStyle.Secondary, '🗂️'),
    ]),
  ];
  return interaction.update({
    embeds: [e('📚 أرشيف المستندات الرسمية — Meeting 967', text)],
    components: withNavigation(components, 'admin:data-center'),
  });
}

async function sendGenerated(interaction, result, message) {
  if (result.bytes <= MAX_ATTACHMENT_BYTES) {
    return interaction.followUp({
      content: `${message}\nالمرجع: **${result.metadata?.reference || result.reference || '—'}**`,
      files: [{ attachment: result.file, name: result.fileName }],
      ephemeral: Boolean(interaction.guildId),
    });
  }
  return interaction.followUp({
    content: `${message}\n⚠️ حجم الملف **${bytes(result.bytes)}** أكبر من حد الإرسال المباشر، لكنه محفوظ بأمان داخل أرشيف البوت.\nالاسم: **${result.fileName}**`,
    ephemeral: Boolean(interaction.guildId),
  });
}

async function generateSection(interaction, app, subject, sectionKey) {
  if (!ARCHIVE_DOCUMENT_SECTIONS[sectionKey]) throw new AppError('ARCHIVE_SECTION_UNKNOWN', 'قسم الأرشيف غير معروف.');
  const result = await service(app).generateSection({ guildId: subject.guildId, sectionKey, actorId: subject.userId });
  return sendGenerated(interaction, result, `✅ تم إنشاء ملف **${ARCHIVE_DOCUMENT_SECTIONS[sectionKey].label}** وحفظه.`);
}

async function generateMember(interaction, app, subject, userId) {
  const result = await service(app).generateMemberRecord({ guildId: subject.guildId, userId, actorId: subject.userId });
  return sendGenerated(interaction, result, '✅ تم إنشاء سجل العضو الرسمي بصيغة Word وحفظه.');
}

async function generateFull(interaction, app, subject) {
  await interaction.followUp({
    content: '⏳ جارٍ إنشاء ملفات الأقسام المنفصلة والحزمة الكاملة. قد يستغرق ذلك قليلًا حسب حجم البيانات.',
    ephemeral: Boolean(interaction.guildId),
  });
  const result = await service(app).generateAll({ guildId: subject.guildId, actorId: subject.userId });
  if (result.bytes <= MAX_ATTACHMENT_BYTES) {
    return interaction.followUp({
      content: `✅ اكتملت الحزمة: **${result.documents.length + 1} ملف Word** منفصلًا مع الفهرس الرئيسي.\nالمرجع: **${result.reference}**`,
      files: [{ attachment: result.bundle, name: result.bundleFileName }],
      ephemeral: Boolean(interaction.guildId),
    });
  }
  const files = result.index.bytes <= MAX_ATTACHMENT_BYTES ? [{ attachment: result.index.file, name: result.index.fileName }] : [];
  return interaction.followUp({
    content: `✅ اكتملت الحزمة: **${result.documents.length + 1} ملف Word**.\n⚠️ حجم الحزمة **${bytes(result.bytes)}** أكبر من حد Discord، لذلك حُفظت محليًا وأرفقتُ الفهرس الرئيسي.\nالمرجع: **${result.reference}**`,
    files,
    ephemeral: Boolean(interaction.guildId),
  });
}

async function history(interaction, app, subject, pageValue) {
  const page = Math.max(0, Number(pageValue) || 0);
  const totalRows = await app.db.query('SELECT count(*)::int count FROM archive_documents WHERE guild_id=$1', [subject.guildId]);
  const total = Number(totalRows.rows[0]?.count || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const { rows } = await app.db.query(`SELECT id,section_key,label,file_name,size_bytes,row_count,created_at
    FROM archive_documents WHERE guild_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [subject.guildId, PAGE_SIZE, safePage * PAGE_SIZE]);
  const lines = rows.map((row, index) => `${safePage * PAGE_SIZE + index + 1}. **${row.label}**\n   ${iso(row.created_at)} — ${bytes(row.size_bytes)} — ${row.row_count} سجل`).join('\n') || 'لا توجد مستندات مولدة حتى الآن.';
  const components = [];
  if (rows.length) components.push(stringSelect('archive-docs:open', 'تنزيل ملف محفوظ', rows.map((row) => ({
    label: String(row.label).slice(0, 100), description: `${bytes(row.size_bytes)} • ${iso(row.created_at).slice(0, 30)}`.slice(0, 100), value: String(row.id),
  }))));
  const pager = [];
  if (safePage > 0) pager.push(btn(`archive-docs:history:${safePage - 1}`, 'السابق', ButtonStyle.Secondary, '⬅️'));
  if (safePage + 1 < pages) pager.push(btn(`archive-docs:history:${safePage + 1}`, 'التالي', ButtonStyle.Secondary, '➡️'));
  if (pager.length) components.push(...rowsFromButtons(pager));
  return interaction.update({
    embeds: [e(`🗂️ مستندات الأرشيف — ${safePage + 1}/${pages}`, lines.slice(0, 3900))],
    components: withNavigation(components, 'archive-docs:home'),
  });
}

async function openStored(interaction, app, subject, documentId) {
  const { rows } = await app.db.query('SELECT * FROM archive_documents WHERE id=$1 AND guild_id=$2', [documentId, subject.guildId]);
  const row = rows[0];
  if (!row) throw new AppError('ARCHIVE_DOCUMENT_NOT_FOUND', 'ملف الأرشيف غير موجود.');
  const storage = path.resolve(app.env.STORAGE_DIR || 'storage');
  const resolved = path.resolve(row.file_path);
  const relative = path.relative(storage, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new AppError('UNSAFE_ARCHIVE_PATH', 'مسار الملف خارج مجلد التخزين المعتمد.');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new AppError('ARCHIVE_DOCUMENT_MISSING', 'الملف مسجل لكن نسخته المحلية غير موجودة.');
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    return interaction.followUp({ content: `⚠️ الملف محفوظ لكنه أكبر من حد الإرسال المباشر: **${row.file_name}** — ${bytes(stat.size)}`, ephemeral: Boolean(interaction.guildId) });
  }
  return interaction.followUp({
    content: `✅ **${row.label}**\nتاريخ الإنشاء: ${iso(row.created_at)}`,
    files: [{ attachment: resolved, name: row.file_name }],
    ephemeral: Boolean(interaction.guildId),
  });
}

export async function handleArchiveDocuments(interaction, app) {
  const id = String(interaction.customId || '');
  const subject = await ownerSubject(interaction, app);
  if (id === 'admin:archive-documents' || id === 'archive-docs:home') return home(interaction, app, subject);
  if (id === 'archive-docs:section') return generateSection(interaction, app, subject, String(interaction.values?.[0] || ''));
  if (id.startsWith('archive-docs:section:')) return generateSection(interaction, app, subject, id.slice('archive-docs:section:'.length));
  if (id.startsWith('archive-docs:member:')) return generateMember(interaction, app, subject, id.slice('archive-docs:member:'.length));
  if (id === 'archive-docs:full') return generateFull(interaction, app, subject);
  if (id === 'archive-docs:open') return openStored(interaction, app, subject, String(interaction.values?.[0] || ''));
  if (id.startsWith('archive-docs:history:')) return history(interaction, app, subject, id.slice('archive-docs:history:'.length));
  return false;
}
