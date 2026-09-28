import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

const GOLD = '9A7422';
const GOLD_DARK = '7B5A17';
const CHARCOAL = '2A2A2A';
const INK = '242424';
const MID_GRAY = '737782';
const LIGHT_GRAY = 'F1F2F4';
const BEIGE = 'F4EEDF';
const WARM_WHITE = 'FAF8F3';
const WHITE = 'FFFFFF';
const BORDER = 'D8D2C6';
const FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Arial', cs: 'Arial' };
const CONTENT_DXA = 9360;
const MAX_TEXT = 420;

const widths = {
  five: [2100, 2500, 1500, 1460, 1800],
  six: [1700, 1900, 1500, 1400, 1360, 1500],
  member: [2100, 1900, 1450, 1260, 2650],
  meeting: [2100, 1600, 1300, 1450, 1450, 1460],
  attendance: [1850, 1750, 1450, 1350, 1360, 1600],
  task: [2100, 1700, 1700, 1400, 1160, 1300],
};

export const ARCHIVE_DOCUMENT_SECTIONS = Object.freeze({
  catalog: { label: 'الفهرس العام لمركز البيانات', description: 'ملخص رسمي لأعداد البيانات المحفوظة في جميع أقسام النظام.', loader: 'catalog', columns: [
    { key: 'category', label: 'القسم', width: 2500 }, { key: 'count', label: 'عدد السجلات', width: 1700, align: 'center' },
    { key: 'state', label: 'الحالة', width: 1800, align: 'center' }, { key: 'updated_at', label: 'آخر تحديث', width: 1860, format: 'datetime' },
    { key: 'note', label: 'ملاحظة', width: 1500 },
  ] },
  members: { label: 'سجلات الأعضاء', description: 'السجل الموحد للأعضاء وحالتهم والفرق المرتبطين بها.', query: `
    SELECT m.user_id::text id,COALESCE(u.display_name,u.username,m.user_id::text) member_name,
      COALESCE(u.username,'—') username,m.active,m.joined_at,
      COALESCE(string_agg(DISTINCT t.name,'، ' ORDER BY t.name) FILTER(WHERE tm.active=true AND t.active=true),'بدون فريق') teams
    FROM members m JOIN users u ON u.id=m.user_id
    LEFT JOIN team_members tm ON tm.guild_id=m.guild_id AND tm.user_id=m.user_id
    LEFT JOIN teams t ON t.id=tm.team_id
    WHERE m.guild_id=$1 GROUP BY m.user_id,u.display_name,u.username,m.active,m.joined_at
    ORDER BY m.active DESC,COALESCE(u.display_name,u.username,m.user_id::text)`, columns: [
    { key: 'member_name', label: 'العضو', width: 2200 }, { key: 'username', label: 'اسم المستخدم', width: 1700 },
    { key: 'teams', label: 'الفريق / الفرق', width: 2500 }, { key: 'active', label: 'الحالة', width: 1100, format: 'active', align: 'center' },
    { key: 'joined_at', label: 'تاريخ الانضمام', width: 1860, format: 'datetime' },
  ] },
  teams: { label: 'سجل الفرق والأقسام', description: 'الفرق المحفوظة وأعداد أعضائها وحالتها ومراجعها.', query: `
    SELECT t.id::text id,t.name,COALESCE(t.description,'—') description,t.active,t.created_at,
      count(tm.user_id) FILTER(WHERE tm.active=true)::int member_count
    FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id
    WHERE t.guild_id=$1 GROUP BY t.id,t.name,t.description,t.active,t.created_at
    ORDER BY t.active DESC,t.name`, columns: [
    { key: 'name', label: 'الفريق / القسم', width: 2200 }, { key: 'description', label: 'الوصف', width: 2800 },
    { key: 'member_count', label: 'الأعضاء', width: 1200, align: 'center' }, { key: 'active', label: 'الحالة', width: 1200, format: 'active', align: 'center' },
    { key: 'created_at', label: 'تاريخ الإنشاء', width: 1960, format: 'datetime' },
  ] },
  permissions: { label: 'سجل الصلاحيات', description: 'فهرس منح الصلاحيات للمستخدمين والرتب والفرق، دون تضمين أي أسرار أو رموز وصول.', query: `
    SELECT 'مستخدم' subject_type,user_id::text subject_id,permission_key,effect,scope_type,COALESCE(scope_id,'عام') scope_id,created_at
      FROM user_permissions WHERE guild_id=$1
    UNION ALL SELECT 'رتبة',role_id::text,permission_key,effect,scope_type,COALESCE(scope_id,'عام'),created_at
      FROM role_permissions WHERE guild_id=$1
    UNION ALL SELECT 'فريق',team_id::text,permission_key,effect,scope_type,COALESCE(scope_id,'عام'),created_at
      FROM team_permissions WHERE guild_id=$1
    ORDER BY created_at DESC`, columns: [
    { key: 'subject_type', label: 'نوع الجهة', width: 1200 }, { key: 'subject_id', label: 'المعرّف', width: 1800, ltr: true },
    { key: 'permission_key', label: 'الصلاحية', width: 2100, ltr: true }, { key: 'effect', label: 'القرار', width: 1100, align: 'center' },
    { key: 'scope_type', label: 'النطاق', width: 1200, align: 'center' }, { key: 'created_at', label: 'تاريخ المنح', width: 1960, format: 'datetime' },
  ] },
  meetings: { label: 'سجل الاجتماعات', description: 'جميع الاجتماعات مع الفريق والحالة وأوقات البدء والانتهاء وسبب الإنهاء.', query: `
    SELECT m.id::text id,m.name,t.name team_name,m.status,m.scheduled_at,m.started_at,m.ended_at,
      COALESCE(to_jsonb(m)->>'end_reason',m.cancel_reason,m.postpone_note,'—') end_reason
    FROM meetings m JOIN teams t ON t.id=m.team_id WHERE m.guild_id=$1
    ORDER BY m.scheduled_at DESC`, columns: [
    { key: 'name', label: 'عنوان الاجتماع', width: widths.meeting[0] }, { key: 'team_name', label: 'الفريق', width: widths.meeting[1] },
    { key: 'status', label: 'الحالة', width: widths.meeting[2], format: 'status', align: 'center' },
    { key: 'scheduled_at', label: 'الموعد', width: widths.meeting[3], format: 'datetime' },
    { key: 'started_at', label: 'البدء', width: widths.meeting[4], format: 'datetime' },
    { key: 'ended_at', label: 'الانتهاء', width: widths.meeting[5], format: 'datetime' },
  ] },
  attendance: { label: 'سجل الحضور والغياب', description: 'الحضور الفعلي لكل اجتماع، المدة، والنسبة والتوقيتات المسجلة.', query: `
    SELECT m.name meeting_name,t.name team_name,COALESCE(u.display_name,u.username,a.user_id::text) member_name,
      a.status,a.total_seconds,a.presence_ratio,a.first_join_at,a.last_leave_at
    FROM attendance a JOIN meetings m ON m.id=a.meeting_id JOIN teams t ON t.id=m.team_id
    LEFT JOIN users u ON u.id=a.user_id WHERE m.guild_id=$1
    ORDER BY m.scheduled_at DESC,member_name`, columns: [
    { key: 'meeting_name', label: 'الاجتماع', width: widths.attendance[0] }, { key: 'team_name', label: 'الفريق', width: widths.attendance[1] },
    { key: 'member_name', label: 'العضو', width: widths.attendance[2] }, { key: 'status', label: 'الحالة', width: widths.attendance[3], format: 'status', align: 'center' },
    { key: 'total_seconds', label: 'المدة', width: widths.attendance[4], format: 'duration', align: 'center' },
    { key: 'presence_ratio', label: 'النسبة', width: widths.attendance[5], format: 'ratio', align: 'center' },
  ] },
  excuses: { label: 'سجل الاعتذارات', description: 'طلبات الاعتذار وقرارات المراجعة وتواريخ التقديم والبت.', query: `
    SELECT x.id::text id,m.name meeting_name,t.name team_name,COALESCE(u.display_name,u.username,x.user_id::text) member_name,
      x.status,x.reason,x.submitted_at,x.decided_at,COALESCE(x.decision_note,'—') decision_note
    FROM excuses x JOIN meetings m ON m.id=x.meeting_id JOIN teams t ON t.id=m.team_id
    LEFT JOIN users u ON u.id=x.user_id WHERE m.guild_id=$1 ORDER BY x.submitted_at DESC`, columns: [
    { key: 'member_name', label: 'العضو', width: 1700 }, { key: 'meeting_name', label: 'الاجتماع', width: 2000 },
    { key: 'team_name', label: 'الفريق', width: 1450 }, { key: 'status', label: 'القرار', width: 1250, format: 'status', align: 'center' },
    { key: 'submitted_at', label: 'تاريخ التقديم', width: 1480, format: 'datetime' }, { key: 'decided_at', label: 'تاريخ القرار', width: 1480, format: 'datetime' },
  ] },
  recordings: { label: 'فهرس التسجيلات الصوتية', description: 'فهرس التسجيلات المحفوظة؛ يبقى الملف الصوتي مستقلًا ويُرفق به هذا السجل الرسمي.', query: `
    SELECT r.id::text id,m.name meeting_name,t.name team_name,r.status,r.started_at,r.stopped_at,
      COALESCE((to_jsonb(r)->>'final_bytes')::bigint,0) bytes,
      regexp_replace(COALESCE(r.storage_path,'—'),'^.*/','','g') file_name
    FROM recordings r JOIN meetings m ON m.id=r.meeting_id JOIN teams t ON t.id=m.team_id
    WHERE m.guild_id=$1 ORDER BY r.started_at DESC`, columns: [
    { key: 'meeting_name', label: 'عنوان الاجتماع', width: 2100 }, { key: 'team_name', label: 'الفريق', width: 1600 },
    { key: 'file_name', label: 'اسم ملف التسجيل', width: 2200, ltr: true }, { key: 'status', label: 'الحالة', width: 1200, format: 'status', align: 'center' },
    { key: 'bytes', label: 'الحجم', width: 1000, format: 'bytes', align: 'center' }, { key: 'started_at', label: 'تاريخ التسجيل', width: 1260, format: 'datetime' },
  ] },
  reports: { label: 'فهرس التقارير الرسمية', description: 'التقارير المولدة، اجتماعاتها، تواريخها، وبصمات التحقق الخاصة بها.', query: `
    SELECT r.id::text id,m.name meeting_name,t.name team_name,r.generated_at,
      regexp_replace(r.path,'^.*/','','g') file_name,r.sha256,COALESCE(r.metadata->>'type','تقرير اجتماع') report_type
    FROM reports r JOIN meetings m ON m.id=r.meeting_id JOIN teams t ON t.id=m.team_id
    WHERE m.guild_id=$1 ORDER BY r.generated_at DESC`, columns: [
    { key: 'file_name', label: 'عنوان الملف', width: 2300 }, { key: 'report_type', label: 'النوع', width: 1300 },
    { key: 'meeting_name', label: 'الاجتماع', width: 1900 }, { key: 'team_name', label: 'الفريق', width: 1400 },
    { key: 'generated_at', label: 'تاريخ الإنشاء', width: 1460, format: 'datetime' }, { key: 'sha256', label: 'بصمة التحقق', width: 1000, format: 'hash', ltr: true },
  ] },
  tasks: { label: 'سجل المهام والتكليفات', description: 'المهام المسندة وحالة التنفيذ والتسليم والمراجعة ومواعيد الاستحقاق.', query: `
    SELECT mt.id::text id,mt.title,t.name team_name,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) assignee_name,
      mt.status,COALESCE(to_jsonb(mt)->>'review_status','—') review_status,mt.due_at,mt.created_at,mt.completed_at
    FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id LEFT JOIN users u ON u.id=mt.assignee_user_id
    WHERE mt.guild_id=$1 ORDER BY COALESCE(mt.due_at,mt.created_at) DESC`, columns: [
    { key: 'title', label: 'المهمة', width: widths.task[0] }, { key: 'team_name', label: 'الفريق', width: widths.task[1] },
    { key: 'assignee_name', label: 'المكلّف', width: widths.task[2] }, { key: 'status', label: 'التنفيذ', width: widths.task[3], format: 'status', align: 'center' },
    { key: 'review_status', label: 'المراجعة', width: widths.task[4], format: 'status', align: 'center' }, { key: 'due_at', label: 'الاستحقاق', width: widths.task[5], format: 'datetime' },
  ] },
  performance: { label: 'فهرس تقارير تقييم الأعضاء', description: 'التقارير الأسبوعية والشهرية للأعضاء ومراجعها وفتراتها ونتائجها.', optional: true, query: `
    SELECT p.id::text id,COALESCE(u.display_name,u.username,p.user_id::text) member_name,p.period_type,p.range_start,p.range_end,
      p.generated_at,p.score,regexp_replace(p.file_path,'^.*/','','g') file_name
    FROM member_performance_reports p LEFT JOIN users u ON u.id=p.user_id
    WHERE p.guild_id=$1 ORDER BY p.generated_at DESC`, columns: [
    { key: 'member_name', label: 'العضو', width: 1800 }, { key: 'period_type', label: 'الفترة', width: 1100, format: 'period', align: 'center' },
    { key: 'range_start', label: 'من', width: 1450, format: 'date' }, { key: 'range_end', label: 'إلى', width: 1450, format: 'date' },
    { key: 'score', label: 'النتيجة', width: 1200, format: 'score', align: 'center' }, { key: 'generated_at', label: 'تاريخ الإنشاء', width: 2360, format: 'datetime' },
  ] },
  support: { label: 'سجل الدعم والحوادث', description: 'طلبات المساعدة والبلاغات التشغيلية وحالتها وتواريخ متابعتها.', optional: true, query: `
    SELECT s.id::text id,COALESCE(u.display_name,u.username,s.user_id::text) member_name,s.request_type,s.subject,s.status,
      s.created_at,s.updated_at,s.closed_at
    FROM support_requests s LEFT JOIN users u ON u.id=s.user_id WHERE s.guild_id=$1 ORDER BY s.created_at DESC`, columns: [
    { key: 'id', label: 'المرجع', width: 900, ltr: true }, { key: 'member_name', label: 'صاحب الطلب', width: 1700 },
    { key: 'request_type', label: 'النوع', width: 1200, format: 'request', align: 'center' }, { key: 'subject', label: 'الموضوع', width: 2600 },
    { key: 'status', label: 'الحالة', width: 1200, format: 'status', align: 'center' }, { key: 'created_at', label: 'تاريخ الفتح', width: 1760, format: 'datetime' },
  ] },
  operations: { label: 'سجل بيانات التشغيل', description: 'حالة مخرجات الاجتماعات والخدمات الخلفية دون تخزين الرموز السرية أو محتوى ملف البيئة.', optional: true, query: `
    SELECT m.name item,t.name category,
      CONCAT('تقرير: ',o.report_status,' | تسجيل: ',o.recording_status,' | تسليم: ',o.delivery_status) state,
      o.attempts count,o.updated_at,COALESCE(o.last_error,'—') note
    FROM meeting_output_state o JOIN meetings m ON m.id=o.meeting_id JOIN teams t ON t.id=m.team_id
    WHERE m.guild_id=$1 ORDER BY o.updated_at DESC`, columns: [
    { key: 'item', label: 'الاجتماع / العملية', width: 2300 }, { key: 'category', label: 'الفريق', width: 1700 },
    { key: 'state', label: 'حالة المخرجات', width: 2700 }, { key: 'count', label: 'المحاولات', width: 1100, align: 'center' },
    { key: 'updated_at', label: 'آخر تحديث', width: 1560, format: 'datetime' },
  ] },
  audit: { label: 'سجل التدقيق', description: 'سجل الإجراءات: من نفّذ الإجراء، ماذا تغير، ومتى، دون عرض القيم السرية.', query: `
    SELECT id::text id,actor_id::text actor_id,action,target_type,COALESCE(target_id,'—') target_id,created_at
    FROM audit_logs WHERE guild_id=$1 ORDER BY created_at DESC`, columns: [
    { key: 'id', label: 'المرجع', width: 900, ltr: true }, { key: 'actor_id', label: 'المنفّذ', width: 1600, ltr: true },
    { key: 'action', label: 'الإجراء', width: 2500, ltr: true }, { key: 'target_type', label: 'نوع الهدف', width: 1500, ltr: true },
    { key: 'target_id', label: 'معرّف الهدف', width: 1300, ltr: true }, { key: 'created_at', label: 'التاريخ والوقت', width: 1560, format: 'datetime' },
  ] },
  backups: { label: 'سجل النسخ الاحتياطية والأرشيفات', description: 'فهرس النسخ الاحتياطية والأرشيفات المغلقة مع الأحجام والتواريخ وحالة التحقق.', loader: 'backups', columns: [
    { key: 'kind', label: 'النوع', width: 1600 }, { key: 'label', label: 'العنوان', width: 2500 },
    { key: 'status', label: 'الحالة', width: 1200, format: 'status', align: 'center' }, { key: 'created_at', label: 'تاريخ الإنشاء', width: 1660, format: 'datetime' },
    { key: 'bytes', label: 'الحجم', width: 1100, format: 'bytes', align: 'center' }, { key: 'reference', label: 'المرجع', width: 1300, ltr: true },
  ] },
});

export const ARCHIVE_DOCUMENT_SECTION_ORDER = Object.freeze(Object.keys(ARCHIVE_DOCUMENT_SECTIONS));

function textValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function safeText(value, max = MAX_TEXT) {
  const text = textValue(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safePart(value, fallback = 'ملف') {
  return safeText(value, 100).replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

function statusArabic(value) {
  return ({
    active: 'نشط', inactive: 'غير نشط', true: 'نشط', false: 'غير نشط', upcoming: 'قادم', ongoing: 'جاري', ended: 'منتهٍ',
    canceled: 'ملغي', postponed: 'مؤجل', present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'معتذر', pending: 'قيد الانتظار',
    approved: 'معتمد', rejected: 'مرفوض', completed: 'مكتمل', failed: 'فشل', recording: 'جارٍ', ready: 'جاهز', sent: 'تم الإرسال',
    partial: 'جزئي', missing: 'غير موجود', open: 'مفتوح', in_progress: 'قيد التنفيذ', closed: 'مغلق', done: 'مكتمل', cancelled: 'ملغى',
    submitted: 'بانتظار المراجعة', not_submitted: 'لم يُسلّم', allow: 'سماح', deny: 'منع', week: 'أسبوعي', month: 'شهري',
  })[String(value)] || safeText(value);
}

function bytesLabel(value) {
  let n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function durationLabel(value) {
  const seconds = Math.max(0, Number(value || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}س ${m}د` : m ? `${m}د ${s}ث` : `${s}ث`;
}

function dateTokens(value, zone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const { year, month, day, hour, minute, second } = values;
  return {
    year, month, day, hour, minute, second,
    compactDate: `${year}${month}${day}`,
    isoDate: `${year}-${month}-${day}`,
    compactDateTime: `${year}${month}${day}-${hour}${minute}${second}`,
    displayDate: `${day}/${month}/${year}`,
    displayDateTime: `${day}/${month}/${year} ${hour}:${minute}`,
  };
}

function formatValue(value, format, zone) {
  if (format === 'datetime' || format === 'date') {
    if (!value) return '—';
    const tokens = dateTokens(value, zone);
    return tokens ? (format === 'date' ? tokens.displayDate : tokens.displayDateTime) : '—';
  }
  if (format === 'bytes') return bytesLabel(value);
  if (format === 'duration') return durationLabel(value);
  if (format === 'ratio') return `${Math.round(Number(value || 0) * 100)}%`;
  if (format === 'score') return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)} / 100`;
  if (format === 'hash') return safeText(value, 16);
  if (format === 'active') return value ? 'نشط' : 'غير نشط';
  if (format === 'status') return statusArabic(value);
  if (format === 'period') return statusArabic(value);
  if (format === 'request') return ({ issue: 'بلاغ مشكلة', help: 'طلب مساعدة' })[String(value)] || safeText(value);
  return safeText(value);
}

function run(text, { bold = false, color = INK, size = 19, rtl = true } = {}) {
  return new TextRun({ text: safeText(text), bold, color, size, font: FONT, rightToLeft: rtl });
}

function paragraph(text = '', { bold = false, color = INK, size = 19, align = AlignmentType.RIGHT, rtl = true, before = 0, after = 70, keepNext = false } = {}) {
  return new Paragraph({
    bidirectional: rtl,
    alignment: align,
    keepNext,
    spacing: { before, after, line: 270 },
    children: [run(text, { bold, color, size, rtl })],
  });
}

const borders = (color = BORDER, size = 4) => ({
  top: { style: BorderStyle.SINGLE, color, size }, bottom: { style: BorderStyle.SINGLE, color, size },
  left: { style: BorderStyle.SINGLE, color, size }, right: { style: BorderStyle.SINGLE, color, size },
});

function tableCell(value, width, { fill = WHITE, bold = false, color = INK, align = AlignmentType.RIGHT, rtl = true, size = 17 } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    borders: borders(),
    children: [paragraph(value, { bold, color, size, align, rtl, after: 0 })],
  });
}

function fixedTable(rows, grid) {
  return new Table({
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    columnWidths: grid,
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: true,
    rows,
  });
}

function infoTable(items) {
  const grid = [1500, 3180, 1500, 3180];
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i] || ['—', '—'];
    const right = items[i + 1] || ['—', '—'];
    rows.push(new TableRow({ cantSplit: true, children: [
      tableCell(left[0], grid[0], { fill: BEIGE, bold: true, color: GOLD_DARK }),
      tableCell(left[1], grid[1]),
      tableCell(right[0], grid[2], { fill: BEIGE, bold: true, color: GOLD_DARK }),
      tableCell(right[1], grid[3]),
    ] }));
  }
  return fixedTable(rows, grid);
}

function callout(title, text) {
  const p = new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0, line: 280 },
    children: [run(`${title}  `, { bold: true, color: GOLD_DARK, size: 19 }), run(text, { size: 19 })],
  });
  return fixedTable([new TableRow({ children: [new TableCell({
    width: { size: CONTENT_DXA, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: WARM_WHITE },
    margins: { top: 150, bottom: 150, left: 170, right: 170 }, borders: borders(GOLD, 7), children: [p],
  })] })], [CONTENT_DXA]);
}

function sectionHeading(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, keepNext: true, spacing: { before: 250, after: 100, line: 300 },
    border: { bottom: { style: BorderStyle.SINGLE, color: GOLD, size: 9, space: 4 } },
    children: [run(text, { bold: true, color: GOLD_DARK, size: 28 })],
  });
}

function dataTable(columns, rows, zone) {
  const grid = columns.map((c) => c.width);
  const total = grid.reduce((sum, n) => sum + n, 0);
  if (total !== CONTENT_DXA) throw new Error(`عرض أعمدة الجدول غير صحيح: ${total}`);
  const tableRows = [new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c) => tableCell(c.label, c.width, {
    fill: CHARCOAL, bold: true, color: WHITE, align: AlignmentType.CENTER, size: 17,
  })) })];
  if (!rows.length) {
    tableRows.push(new TableRow({ children: [tableCell('لا توجد بيانات محفوظة في هذا القسم حتى الآن.', CONTENT_DXA, { fill: WARM_WHITE, align: AlignmentType.CENTER })] }));
  } else {
    rows.forEach((row, index) => {
      const fill = index % 2 ? WHITE : WARM_WHITE;
      tableRows.push(new TableRow({ cantSplit: true, children: columns.map((c) => tableCell(
        formatValue(row[c.key], c.format, zone), c.width,
        { fill, rtl: !c.ltr, align: c.align === 'center' ? AlignmentType.CENTER : AlignmentType.RIGHT },
      )) }));
    });
  }
  return fixedTable(tableRows, grid);
}

async function sha256(file) {
  const data = await fs.readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

function tarBundle(bundlePath, directory) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', bundlePath, '-C', path.dirname(directory), path.basename(directory)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${error.slice(0, 500)}`)));
  });
}

export class ArchiveDocumentService {
  constructor({ db, env, audit = null, logger = null }) {
    Object.assign(this, { db, env, audit, logger });
  }

  async safeQuery(sql, params = []) {
    try { return (await this.db.query(sql, params)).rows; }
    catch (error) {
      if (['42P01', '42703'].includes(error?.code)) return [];
      throw error;
    }
  }

  async zone(guildId) {
    const rows = await this.safeQuery('SELECT timezone FROM settings WHERE guild_id=$1', [guildId]);
    return rows[0]?.timezone || 'Asia/Riyadh';
  }

  async catalogRows(guildId) {
    const specs = [
      ['الأعضاء', 'SELECT count(*)::int count,max(joined_at) updated_at FROM members WHERE guild_id=$1', 'بيانات دائمة'],
      ['الفرق', 'SELECT count(*)::int count,max(updated_at) updated_at FROM teams WHERE guild_id=$1', 'بيانات دائمة'],
      ['الاجتماعات', 'SELECT count(*)::int count,max(updated_at) updated_at FROM meetings WHERE guild_id=$1', 'بيانات تشغيل'],
      ['الحضور', 'SELECT count(*)::int count,max(a.updated_at) updated_at FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1', 'بيانات تشغيل'],
      ['الاعتذارات', 'SELECT count(*)::int count,max(x.submitted_at) updated_at FROM excuses x JOIN meetings m ON m.id=x.meeting_id WHERE m.guild_id=$1', 'بيانات تشغيل'],
      ['التسجيلات', 'SELECT count(*)::int count,max(r.started_at) updated_at FROM recordings r JOIN meetings m ON m.id=r.meeting_id WHERE m.guild_id=$1', 'ملفات صوتية'],
      ['التقارير', 'SELECT count(*)::int count,max(r.generated_at) updated_at FROM reports r JOIN meetings m ON m.id=r.meeting_id WHERE m.guild_id=$1', 'ملفات Word'],
      ['المهام', 'SELECT count(*)::int count,max(updated_at) updated_at FROM meeting_tasks WHERE guild_id=$1', 'بيانات تشغيل'],
      ['تقارير التقييم', 'SELECT count(*)::int count,max(generated_at) updated_at FROM member_performance_reports WHERE guild_id=$1', 'ملفات Word'],
      ['الدعم والحوادث', 'SELECT count(*)::int count,max(updated_at) updated_at FROM support_requests WHERE guild_id=$1', 'بيانات تشغيل'],
      ['سجل التدقيق', 'SELECT count(*)::int count,max(created_at) updated_at FROM audit_logs WHERE guild_id=$1', 'بيانات رقابية'],
      ['النسخ الاحتياطية', 'SELECT count(*)::int count,max(started_at) updated_at FROM backups WHERE guild_id=$1', 'حماية واسترجاع'],
      ['الأرشيفات المغلقة', 'SELECT count(*)::int count,max(created_at) updated_at FROM data_archives WHERE guild_id=$1', 'حماية واسترجاع'],
    ];
    const rows = [];
    for (const [category, sql, note] of specs) {
      const result = await this.safeQuery(sql, [guildId]);
      rows.push({ category, count: Number(result[0]?.count || 0), state: 'محفوظ', updated_at: result[0]?.updated_at || null, note });
    }
    return rows;
  }

  async backupRows(guildId) {
    const backups = await this.safeQuery(`SELECT 'نسخة احتياطية' kind,COALESCE(regexp_replace(path,'^.*/','','g'),'نسخة احتياطية') label,
      status,started_at created_at,COALESCE(size_bytes,0) bytes,id::text reference FROM backups WHERE guild_id=$1 ORDER BY started_at DESC`, [guildId]);
    const archives = await this.safeQuery(`SELECT 'أرشيف مغلق' kind,label,status,created_at,total_bytes bytes,id::text reference
      FROM data_archives WHERE guild_id=$1 ORDER BY created_at DESC`, [guildId]);
    return [...backups, ...archives].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  async loadRows(sectionKey, guildId) {
    const definition = ARCHIVE_DOCUMENT_SECTIONS[sectionKey];
    if (!definition) throw new Error(`قسم الأرشيف غير معروف: ${sectionKey}`);
    if (definition.loader === 'catalog') return this.catalogRows(guildId);
    if (definition.loader === 'backups') return this.backupRows(guildId);
    return this.safeQuery(definition.query, [guildId]);
  }

  async buildDocument({ title, description, reference, generatedAt, metadata, blocks, zone }) {
    const logoCandidates = [
      path.resolve('src', 'assets', 'archive-documents-logo.png'),
      path.resolve('src', 'assets', 'meeting967-logo-clean.png'),
      path.resolve('src', 'assets', 'meeting967-logo.png'),
    ];
    let logo = null;
    for (const candidate of logoCandidates) {
      logo = await fs.readFile(candidate).catch(() => null);
      if (logo) break;
    }
    const children = [];
    if (logo) children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 },
      children: [new ImageRun({
        data: logo,
        type: 'png',
        transformation: { width: 84, height: 84 },
        altText: { title: 'شعار حركة 967', description: 'شعار 967 الدائري بخلفية شفافة', name: 'Meeting 967 logo' },
      })],
    }));
    children.push(
      paragraph('حركة 967', { bold: true, color: GOLD, size: 20, align: AlignmentType.CENTER, after: 40 }),
      paragraph(title, { bold: true, color: CHARCOAL, size: 42, align: AlignmentType.CENTER, after: 30 }),
      paragraph('مركز البيانات | أرشيف المستندات الرسمية', { bold: true, color: MID_GRAY, size: 21, align: AlignmentType.CENTER, after: 90 }),
      fixedTable([new TableRow({ children: [tableCell('نسخة داخلية — للمالك والمخولين فقط', CONTENT_DXA, {
        fill: BEIGE, bold: true, color: GOLD_DARK, align: AlignmentType.CENTER, size: 17,
      })] })], [CONTENT_DXA]),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
      infoTable(metadata),
      new Paragraph({ spacing: { after: 100 }, children: [] }),
      callout('الغرض من الملف', description),
    );
    for (const block of blocks) {
      children.push(sectionHeading(block.title), dataTable(block.columns, block.rows, zone));
    }
    const issued = dateTokens(generatedAt, zone)?.displayDateTime || '—';
    const footer = new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER, bidirectional: true, spacing: { before: 0, after: 0 },
      children: [
        run(`داخلي — Meeting 967 | ${reference} | ${issued} | صفحة `, { color: MID_GRAY, size: 14 }),
        new TextRun({ children: [PageNumber.CURRENT], color: MID_GRAY, size: 14, font: FONT }),
      ],
    })] });
    return new Document({
      creator: 'Meeting 967', title: `${title} - ${reference}`, description,
      styles: { default: { document: { run: { font: FONT, size: 19, color: INK }, paragraph: { spacing: { line: 270 } } } } },
      sections: [{
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 1440, bottom: 780, left: 1440 } },
        },
        footers: { default: footer }, children,
      }],
    });
  }

  async register({ id, guildId, sectionKey, label, file, actorId, rowCount, sha, bytes, metadata = {}, periodStart = null, periodEnd = null }) {
    await this.db.query(`INSERT INTO archive_documents
      (id,guild_id,section_key,label,file_path,file_name,mime_type,created_by,period_start,period_end,row_count,sha256,size_bytes,metadata)
      VALUES($1,$2,$3,$4,$5,$6,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',$7,$8,$9,$10,$11,$12,$13::jsonb)`, [
      id, guildId, sectionKey, label, file, path.basename(file), actorId, periodStart, periodEnd, rowCount, sha, bytes, JSON.stringify(metadata),
    ]);
    await this.audit?.log?.({
      guildId, actorId, action: 'archive.document_generated', targetType: 'archive_document', targetId: id,
      newValue: { sectionKey, label, fileName: path.basename(file), rowCount, bytes, sha256: sha },
    }).catch(() => {});
  }

  async saveDocument({ doc, outputDir, fileName, registry }) {
    await fs.mkdir(outputDir, { recursive: true });
    const file = path.join(outputDir, safePart(fileName, 'Meeting 967.docx'));
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(file, buffer, { mode: 0o600 });
    const [sha, stat] = await Promise.all([sha256(file), fs.stat(file)]);
    try { await this.register({ ...registry, file, sha, bytes: stat.size }); }
    catch (error) { await fs.rm(file, { force: true }).catch(() => {}); throw error; }
    return { ...registry, file, fileName: path.basename(file), sha256: sha, bytes: stat.size };
  }

  async generateSection({ guildId, sectionKey, actorId, outputDir = null }) {
    const definition = ARCHIVE_DOCUMENT_SECTIONS[sectionKey];
    if (!definition) throw new Error(`قسم الأرشيف غير معروف: ${sectionKey}`);
    const [rows, zone] = await Promise.all([this.loadRows(sectionKey, guildId), this.zone(guildId)]);
    const now = new Date();
    const id = randomUUID();
    const date = dateTokens(now, zone);
    const reference = `AR-${sectionKey.toUpperCase()}-${date.compactDate}-${id.slice(0, 8).toUpperCase()}`;
    const dir = outputDir || path.resolve(this.env.STORAGE_DIR || 'storage', 'archive-documents', String(guildId), date.year, date.month, sectionKey);
    const doc = await this.buildDocument({
      title: definition.label, description: definition.description, reference, generatedAt: now, zone,
      metadata: [
        ['القسم', definition.label], ['الرقم المرجعي', reference],
        ['تاريخ الإصدار', date.displayDateTime], ['عدد السجلات', rows.length],
        ['مصدر البيانات', 'Meeting 967'], ['حالة الملف', 'مولّد ومحفوظ'],
      ],
      blocks: [{ title: definition.label, columns: definition.columns, rows }],
    });
    return this.saveDocument({
      doc, outputDir: dir, fileName: `${definition.label} - ${date.isoDate} - ${reference}.docx`,
      registry: { id, guildId, sectionKey, label: definition.label, actorId, rowCount: rows.length, metadata: { reference, generatedAt: now.toISOString(), formatVersion: '1.7.4' } },
    });
  }

  async generateMemberRecord({ guildId, userId, actorId }) {
    const zone = await this.zone(guildId);
    const profile = (await this.safeQuery(`SELECT m.user_id::text id,COALESCE(u.display_name,u.username,m.user_id::text) member_name,
      COALESCE(u.username,'—') username,m.active,m.joined_at,
      COALESCE(string_agg(DISTINCT t.name,'، ' ORDER BY t.name) FILTER(WHERE tm.active=true AND t.active=true),'بدون فريق') teams
      FROM members m JOIN users u ON u.id=m.user_id LEFT JOIN team_members tm ON tm.guild_id=m.guild_id AND tm.user_id=m.user_id
      LEFT JOIN teams t ON t.id=tm.team_id WHERE m.guild_id=$1 AND m.user_id=$2
      GROUP BY m.user_id,u.display_name,u.username,m.active,m.joined_at`, [guildId, userId]))[0];
    if (!profile) throw new Error('سجل العضو غير موجود.');
    const [attendanceRows, excuseRows, taskRows, performanceRows, permissionRows, supportRows] = await Promise.all([
      this.safeQuery(`SELECT m.name meeting_name,a.status,a.total_seconds,a.presence_ratio,m.scheduled_at
        FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1 AND a.user_id=$2 ORDER BY m.scheduled_at DESC`, [guildId, userId]),
      this.safeQuery(`SELECT m.name meeting_name,x.status,x.submitted_at,x.decided_at FROM excuses x JOIN meetings m ON m.id=x.meeting_id
        WHERE m.guild_id=$1 AND x.user_id=$2 ORDER BY x.submitted_at DESC`, [guildId, userId]),
      this.safeQuery(`SELECT title,status,COALESCE(to_jsonb(meeting_tasks)->>'review_status','—') review_status,due_at,created_at
        FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2 ORDER BY created_at DESC`, [guildId, userId]),
      this.safeQuery(`SELECT period_type,range_start,range_end,score,generated_at FROM member_performance_reports
        WHERE guild_id=$1 AND user_id=$2 ORDER BY generated_at DESC`, [guildId, userId]),
      this.safeQuery(`SELECT permission_key,effect,scope_type,COALESCE(scope_id,'عام') scope_id,created_at FROM user_permissions
        WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`, [guildId, userId]),
      this.safeQuery(`SELECT id::text id,request_type,subject,status,created_at FROM support_requests
        WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`, [guildId, userId]),
    ]);
    const now = new Date();
    const date = dateTokens(now, zone);
    const id = randomUUID();
    const reference = `AR-MEMBER-${date.compactDate}-${id.slice(0, 8).toUpperCase()}`;
    const blocks = [
      { title: 'الحضور والاجتماعات', columns: [
        { key: 'meeting_name', label: 'الاجتماع', width: 2600 }, { key: 'status', label: 'الحالة', width: 1500, format: 'status', align: 'center' },
        { key: 'total_seconds', label: 'المدة', width: 1400, format: 'duration', align: 'center' }, { key: 'presence_ratio', label: 'النسبة', width: 1400, format: 'ratio', align: 'center' },
        { key: 'scheduled_at', label: 'التاريخ', width: 2460, format: 'datetime' },
      ], rows: attendanceRows },
      { title: 'الاعتذارات', columns: [
        { key: 'meeting_name', label: 'الاجتماع', width: 3000 }, { key: 'status', label: 'القرار', width: 1600, format: 'status', align: 'center' },
        { key: 'submitted_at', label: 'تاريخ التقديم', width: 2380, format: 'datetime' }, { key: 'decided_at', label: 'تاريخ القرار', width: 2380, format: 'datetime' },
      ], rows: excuseRows },
      { title: 'المهام والتكليفات', columns: [
        { key: 'title', label: 'المهمة', width: 3200 }, { key: 'status', label: 'الحالة', width: 1600, format: 'status', align: 'center' },
        { key: 'review_status', label: 'المراجعة', width: 1800, format: 'status', align: 'center' }, { key: 'due_at', label: 'الاستحقاق', width: 2760, format: 'datetime' },
      ], rows: taskRows },
      { title: 'تقارير التقييم', columns: [
        { key: 'period_type', label: 'الفترة', width: 1600, format: 'period', align: 'center' }, { key: 'range_start', label: 'من', width: 1800, format: 'date' },
        { key: 'range_end', label: 'إلى', width: 1800, format: 'date' }, { key: 'score', label: 'النتيجة', width: 1700, format: 'score', align: 'center' },
        { key: 'generated_at', label: 'تاريخ التقرير', width: 2460, format: 'datetime' },
      ], rows: performanceRows },
      { title: 'الصلاحيات المباشرة', columns: [
        { key: 'permission_key', label: 'الصلاحية', width: 3000, ltr: true }, { key: 'effect', label: 'القرار', width: 1300, format: 'status', align: 'center' },
        { key: 'scope_type', label: 'نوع النطاق', width: 1600 }, { key: 'scope_id', label: 'النطاق', width: 1460, ltr: true },
        { key: 'created_at', label: 'تاريخ المنح', width: 2000, format: 'datetime' },
      ], rows: permissionRows },
      { title: 'طلبات الدعم', columns: [
        { key: 'id', label: 'المرجع', width: 900, ltr: true }, { key: 'request_type', label: 'النوع', width: 1500, format: 'request', align: 'center' },
        { key: 'subject', label: 'الموضوع', width: 3500 }, { key: 'status', label: 'الحالة', width: 1300, format: 'status', align: 'center' },
        { key: 'created_at', label: 'التاريخ', width: 2160, format: 'datetime' },
      ], rows: supportRows },
    ];
    const rowCount = blocks.reduce((sum, block) => sum + block.rows.length, 0);
    const doc = await this.buildDocument({
      title: `سجل العضو — ${profile.member_name}`, description: 'ملف رسمي مستقل يجمع بيانات العضو المحفوظة في Meeting 967 دون أسرار أو رموز وصول.',
      reference, generatedAt: now, zone,
      metadata: [
        ['العضو', profile.member_name], ['المعرّف', profile.id], ['الفريق / الفرق', profile.teams], ['الحالة', profile.active ? 'نشط' : 'غير نشط'],
        ['تاريخ الانضمام', formatValue(profile.joined_at, 'datetime', zone)], ['تاريخ الإصدار', date.displayDateTime],
        ['الرقم المرجعي', reference], ['عدد السجلات التابعة', rowCount],
      ], blocks,
    });
    const outputDir = path.resolve(this.env.STORAGE_DIR || 'storage', 'archive-documents', String(guildId), date.year, date.month, 'member-records', String(userId));
    return this.saveDocument({
      doc, outputDir, fileName: `سجل العضو ${safePart(profile.member_name)} - ${date.isoDate} - ${reference}.docx`,
      registry: { id, guildId, sectionKey: 'member_record', label: `سجل العضو — ${profile.member_name}`, actorId, rowCount, metadata: { reference, userId: String(userId), generatedAt: now.toISOString(), formatVersion: '1.7.4' } },
    });
  }

  async generateAll({ guildId, actorId }) {
    const zone = await this.zone(guildId);
    const now = new Date();
    const date = dateTokens(now, zone);
    const runId = randomUUID();
    const reference = `AR-FULL-${date.compactDate}-${runId.slice(0, 8).toUpperCase()}`;
    const root = path.resolve(this.env.STORAGE_DIR || 'storage', 'archive-documents', String(guildId), date.year, date.month);
    const runDir = path.join(root, `full-${date.compactDateTime}-${runId.slice(0, 8)}`);
    await fs.mkdir(runDir, { recursive: true });
    const documents = [];
    for (const sectionKey of ARCHIVE_DOCUMENT_SECTION_ORDER) {
      documents.push(await this.generateSection({ guildId, sectionKey, actorId, outputDir: runDir }));
    }
    const indexId = randomUUID();
    const indexRows = documents.map((item) => ({
      section: ARCHIVE_DOCUMENT_SECTIONS[item.sectionKey]?.label || item.sectionKey,
      file_name: item.fileName, rows: item.rowCount, bytes: item.bytes, sha: item.sha256,
    }));
    const indexColumns = [
      { key: 'section', label: 'القسم', width: 2300 }, { key: 'file_name', label: 'اسم الملف', width: 3200 },
      { key: 'rows', label: 'السجلات', width: 1100, align: 'center' }, { key: 'bytes', label: 'الحجم', width: 1200, format: 'bytes', align: 'center' },
      { key: 'sha', label: 'البصمة', width: 1560, format: 'hash', ltr: true },
    ];
    const indexDoc = await this.buildDocument({
      title: 'الفهرس الرئيسي لحزمة الأرشيف', description: 'فهرس جامع للملفات الرسمية المنفصلة التي أنشأها النظام في هذه الحزمة.',
      reference, generatedAt: now, zone,
      metadata: [
        ['نوع الحزمة', 'أرشيف مستندات كامل'], ['الرقم المرجعي', reference], ['تاريخ الإنشاء', date.displayDateTime], ['عدد الملفات', documents.length],
        ['الحالة', 'مكتملة'], ['مصدر البيانات', 'Meeting 967'],
      ],
      blocks: [{ title: 'محتويات الحزمة', columns: indexColumns, rows: indexRows }],
    });
    const index = await this.saveDocument({
      doc: indexDoc, outputDir: runDir, fileName: `00 - الفهرس الرئيسي - ${reference}.docx`,
      registry: { id: indexId, guildId, sectionKey: 'bundle_index', label: 'الفهرس الرئيسي لحزمة الأرشيف', actorId, rowCount: documents.length, metadata: { reference, runId, generatedAt: now.toISOString(), formatVersion: '1.7.4' } },
    });
    const manifest = {
      format: 'Meeting 967 document archive v1.7.4', guildId: String(guildId), runId, reference,
      generatedAt: now.toISOString(), documents: [index, ...documents].map((item) => ({
        sectionKey: item.sectionKey, label: item.label, fileName: item.fileName, rows: item.rowCount, bytes: item.bytes, sha256: item.sha256,
      })),
    };
    const manifestPath = path.join(runDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
    const bundle = path.join(root, `Meeting967-Document-Archive-${date.compactDateTime}-${runId.slice(0, 8)}.tar.gz`);
    await tarBundle(bundle, runDir);
    const [bundleSha, bundleStat] = await Promise.all([sha256(bundle), fs.stat(bundle)]);
    await this.db.query(`INSERT INTO archive_documents
      (id,guild_id,section_key,label,file_path,file_name,mime_type,created_by,row_count,sha256,size_bytes,metadata)
      VALUES($1,$2,'full_bundle',$3,$4,$5,'application/gzip',$6,$7,$8,$9,$10::jsonb)`, [
      runId, guildId, 'حزمة أرشيف المستندات الكاملة', bundle, path.basename(bundle), actorId, documents.length + 1, bundleSha, bundleStat.size,
      JSON.stringify({ reference, runDir, manifest: path.basename(manifestPath), generatedAt: now.toISOString(), formatVersion: '1.7.4' }),
    ]);
    await this.audit?.log?.({
      guildId, actorId, action: 'archive.document_bundle_generated', targetType: 'archive_document_bundle', targetId: runId,
      newValue: { reference, documentCount: documents.length + 1, fileName: path.basename(bundle), bytes: bundleStat.size, sha256: bundleSha },
    }).catch(() => {});
    return { id: runId, reference, bundle, bundleFileName: path.basename(bundle), bytes: bundleStat.size, sha256: bundleSha, index, documents, runDir };
  }
}
