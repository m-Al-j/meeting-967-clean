import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import {
  arrivalLabel,
  attendanceSummary,
  coverageLabel,
  formatDuration,
  meetingStatusLabel,
  statusLabel,
} from '../../core/reports/metrics.js';

const GOLD = 'A8832F';
const DARK = '262626';
const LIGHT = 'F7F3E8';
const PALE = 'FCFAF5';
const WHITE = 'FFFFFF';
const GREEN = 'E8F5E9';
const RED = 'FDECEC';
const AMBER = 'FFF8E1';
const EVIDENCE_GREEN = '356A3A';
const GRAY = '666666';
const BORDER = 'D8D1C2';
const FONT = 'Arial';

const thinBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
};

const hasArabic = (value) => /[\u0600-\u06FF]/.test(String(value ?? ''));
const asText = (value) => value === null || value === undefined || value === '' ? '—' : String(value);

function cleanTeamName(value) {
  return asText(value)
    .replaceAll('الاداره', 'الإدارة')
    .replaceAll('الادارة', 'الإدارة');
}

function teamFileKey(value) {
  const text = cleanTeamName(value);
  if (text.includes('الحوكمة') || text.includes('الإدارة')) return 'governance';
  if (text.includes('العضوية') || text.includes('التنظيم الداخلي')) return 'membership';
  if (text.includes('المشاريع') || text.includes('الخدمات المجتمعية')) return 'projects';
  if (text.includes('التقنية') || text.includes('البحث') || text.includes('البيانات')) return 'tech';
  if (text.includes('الإعلام') || text.includes('العلاقات') || text.includes('الشراكات')) return 'media';
  return 'team';
}

function cleanDiscordChannelName(value) {
  if (!value) return null;
  const text = String(value)
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\uFFFD+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[「」『』【】〖〗《》〈〉〔〕（）()\[\]{}#]/g, ' ')
    .replace(/[│┃┆┇┊┋╎╏═━─—–_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function arRun(text, { bold = false, color = DARK, size = 21 } = {}) {
  return new TextRun({
    text: asText(text),
    bold,
    color,
    size,
    font: FONT,
    rightToLeft: true,
  });
}

function ltrRun(text, { bold = false, color = DARK, size = 21 } = {}) {
  return new TextRun({
    text: asText(text),
    bold,
    color,
    size,
    font: FONT,
    rightToLeft: false,
  });
}

function arP(text = '', {
  bold = false,
  color = DARK,
  size = 21,
  alignment = AlignmentType.RIGHT,
  before = 0,
  after = 0,
  keepNext = false,
  pageBreakBefore = false,
  border,
} = {}) {
  return new Paragraph({
    alignment,
    bidirectional: true,
    keepNext,
    pageBreakBefore,
    spacing: { before, after, line: 260 },
    border,
    children: [arRun(text, { bold, color, size })],
  });
}

function ltrP(text = '', {
  bold = false,
  color = DARK,
  size = 21,
  alignment = AlignmentType.CENTER,
  before = 0,
  after = 0,
  keepNext = false,
} = {}) {
  return new Paragraph({
    alignment,
    bidirectional: false,
    keepNext,
    spacing: { before, after, line: 260 },
    children: [ltrRun(text, { bold, color, size })],
  });
}

function arCell(text, {
  fill = WHITE,
  bold = false,
  color = DARK,
  size = 19,
  center = false,
} = {}) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 80, bottom: 80, left: 90, right: 90 },
    children: [arP(text, {
      bold,
      color,
      size,
      alignment: center ? AlignmentType.CENTER : AlignmentType.RIGHT,
    })],
  });
}

function ltrCell(text, {
  fill = WHITE,
  bold = false,
  color = DARK,
  size = 19,
  alignment = AlignmentType.CENTER,
} = {}) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 80, bottom: 80, left: 90, right: 90 },
    children: [ltrP(text, { bold, color, size, alignment })],
  });
}

function smartCell(text, options = {}) {
  return hasArabic(text)
    ? arCell(text, options)
    : ltrCell(text, { ...options, alignment: AlignmentType.LEFT });
}

function infoPair(label, value, direction = 'auto') {
  let valueCell;
  if (direction === 'ltr') valueCell = ltrCell(value, { alignment: AlignmentType.LEFT });
  else if (direction === 'rtl') valueCell = arCell(value);
  else valueCell = hasArabic(value) ? arCell(value) : ltrCell(value, { alignment: AlignmentType.LEFT });

  return new TableRow({
    cantSplit: true,
    children: [
      valueCell,
      arCell(label, { fill: LIGHT, bold: true }),
    ],
  });
}

function twoColumnTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    columnWidths: [6000, 3300],
    borders: thinBorders,
    rows: rows.map(([label, value, direction = 'auto']) => infoPair(label, value, direction)),
  });
}

function summaryCell(label, value) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill: PALE },
    margins: { top: 90, bottom: 90, left: 80, right: 80 },
    children: [
      ltrP(value, { bold: true, color: GOLD, size: 28, alignment: AlignmentType.CENTER, after: 30 }),
      arP(label, { size: 18, alignment: AlignmentType.CENTER }),
    ],
  });
}

function sectionTitle(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [9300],
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: DARK },
      bottom: { style: BorderStyle.NONE, size: 0, color: DARK },
      left: { style: BorderStyle.NONE, size: 0, color: DARK },
      right: { style: BorderStyle.NONE, size: 0, color: DARK },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: DARK },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: DARK },
    },
    rows: [new TableRow({ cantSplit: true, children: [arCell(text, { fill: DARK, bold: true, color: WHITE, size: 20 })] })],
  });
}

function spacer(after = 65) {
  return new Paragraph({ spacing: { after }, children: [] });
}

function noteBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [9300],
    borders: thinBorders,
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: LIGHT },
        margins: { top: 100, bottom: 100, left: 110, right: 110 },
        children: [arP(text, { color: GRAY, size: 17 })],
      })],
    })],
  });
}

function decisionCard({ number, text, status, priority, owner, due, evidence }) {
  const fill = status === 'تم التنفيذ' ? GREEN : priority === 'حرجة' ? AMBER : PALE;
  const paragraphs = [
    arP(`${number}. ${text}`, { bold: true, size: 19, after: 45 }),
    arP(`الحالة: ${status}  •  الأولوية: ${priority}  •  المسؤول: ${owner}  •  الموعد: ${due}`, { color: GRAY, size: 17 }),
  ];
  if (evidence) paragraphs.push(arP(`دليل التنفيذ: ${evidence}`, { color: EVIDENCE_GREEN, size: 17, before: 25 }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [9300],
    borders: thinBorders,
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill },
        margins: { top: 105, bottom: 105, left: 115, right: 115 },
        children: paragraphs,
      })],
    })],
  });
}


function attendanceDisplayLabel(row) {
  if (row?.status === 'late') return 'متأخر';
  if (row?.status === 'absent') return 'غائب';
  if (row?.status === 'excused') return 'معتذر';
  const ratio = Math.max(0, Math.min(1, Number(row?.presence_ratio ?? 0)));
  if (row?.full_attendance || ratio >= 0.9) return 'حاضر';
  if (ratio >= 0.5) return 'حضور جزئي';
  if (row?.first_join_at) return 'حضور قصير';
  return statusLabel(row?.status);
}

function statusFill(row) {
  if (row?.status === 'absent') return RED;
  if (row?.status === 'excused' || row?.status === 'late') return AMBER;
  const ratio = Math.max(0, Math.min(1, Number(row?.presence_ratio ?? 0)));
  if (row?.status === 'present' && (row?.full_attendance || ratio >= 0.9)) return GREEN;
  if (row?.first_join_at) return AMBER;
  return WHITE;
}

function formatDateOnly(value, zone) {
  if (!value) return '—';
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toFormat('dd/MM/yyyy');
}

function formatTimeOnly(value, zone) {
  if (!value) return '—';
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toFormat('HH:mm');
}

function formatDayName(value, zone) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try { return new Intl.DateTimeFormat('ar-SA', { timeZone: zone, weekday: 'long' }).format(date); }
  catch { return '—'; }
}

function formatHijriDate(value, zone) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options = { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' };
  try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', options).format(date); }
  catch {
    try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-nu-latn', options).format(date); }
    catch { return '—'; }
  }
}

function safeFilePart(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'اجتماع';
}

function buildMeetingTitle(name, teamName, meetingNumber) {
  const meetingName = String(name ?? '').trim();
  if (meetingName) return `${meetingName} - فريق ${teamName} - ${meetingNumber}`;
  return `اجتماع فريق ${teamName} - ${meetingNumber}`;
}

function formatDateTime(value, zone) {
  if (!value) return '—';
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toFormat('dd/MM/yyyy HH:mm');
}

function formatDecisionDue(value, zone) {
  if (!value) return 'غير محدد';
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toFormat('HH:mm dd/MM/yyyy');
}

function earliestJoin(rows, fallback) {
  const dates = rows
    .map((r) => r.first_join_at)
    .filter(Boolean)
    .map((x) => new Date(x).getTime())
    .filter(Number.isFinite);
  if (!dates.length) return fallback;
  return new Date(Math.min(...dates));
}

function startModeLabel(mode) {
  if (mode === 'autopilot') return 'تلقائي';
  if (mode === 'recovery') return 'استرداد تلقائي';
  return 'يدوي';
}

export class ReportService {
  constructor({ meetings, attendance, reports, guilds, recordings = null, excuses = null, tasks = null, env }) {
    Object.assign(this, { meetings, attendance, reports, guilds, recordings, excuses, tasks, env });
  }

  async generate({ guildId, meetingId, actorId, guild }) {
    const meeting = await this.meetings.get(meetingId);
    if (!meeting) throw new Error('Meeting not found');

    const settings = await this.guilds.getSettings(guildId);
    const rows = this.attendance.reportRows
      ? await this.attendance.reportRows(meetingId)
      : await this.attendance.rows(meetingId);
    const decisions = await this.meetings.decisions(meetingId);
    const tasks = this.tasks ? await this.tasks.listForMeeting(meetingId).catch(() => []) : [];
    const meetingNumber = this.meetings.ordinal ? await this.meetings.ordinal(meetingId) : 1;
    const approvedExcuses = this.excuses?.approvedForMeeting
      ? await this.excuses.approvedForMeeting(meetingId)
      : [];
    const recording = this.recordings
      ? await this.recordings.latestForMeeting(meetingId).catch(() => null)
      : null;
    const tracks = recording && this.recordings
      ? await this.recordings.tracks(recording.id).catch(() => [])
      : [];

    const duration = meeting.started_at && meeting.ended_at
      ? Math.max(0, Math.floor((new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000))
      : 0;
    const zone = settings?.timezone || 'Asia/Aden';
    const summary = attendanceSummary(rows, duration, meeting.scheduled_at);
    const observationAt = earliestJoin(rows, meeting.started_at || meeting.scheduled_at);

    const voiceChannelRaw = guild && meeting.voice_channel_id
      ? (await guild.channels.fetch(String(meeting.voice_channel_id)).catch(() => null))?.name
      : null;
    const voiceChannelName = cleanDiscordChannelName(voiceChannelRaw);
    const teamName = cleanTeamName(meeting.team_name);
    const meetingDateValue = meeting.started_at || meeting.scheduled_at;
    const reportTitle = buildMeetingTitle(meeting.name, teamName, meetingNumber);

    const logoPath = path.resolve('src', 'assets', 'meeting967-logo.png');
    const logo = await fs.readFile(logoPath).catch(() => null);
    const children = [];

    if (logo) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 55 },
        children: [new ImageRun({ data: logo, type: 'png', transformation: { width: 82, height: 82 } })],
      }));
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4300, 2800, 2200],
        rows: [new TableRow({ cantSplit: true, children: [
          ltrCell('967', { fill: GOLD, color: WHITE, bold: true, alignment: AlignmentType.LEFT, size: 18 }),
          arCell('نظام الاجتماعات والتوثيق', { fill: DARK, color: WHITE, bold: true, center: true, size: 17 }),
          ltrCell('MEETING 967', { fill: DARK, color: WHITE, bold: true, alignment: AlignmentType.CENTER, size: 17 }),
        ] })],
      }),
      arP('تقرير الاجتماع الرسمي', { bold: true, size: 31, alignment: AlignmentType.CENTER, before: 70, after: 20 }),
      arP(reportTitle, { bold: true, size: 23, alignment: AlignmentType.CENTER, after: 100 }),

      sectionTitle('بيانات الاجتماع'),
      twoColumnTable([
        ['عنوان الاجتماع', reportTitle, 'rtl'],
        ['الفريق', teamName, 'rtl'],
        ['رقم الاجتماع', meetingNumber, 'ltr'],
        ['اليوم', formatDayName(meetingDateValue, zone), 'rtl'],
        ['التاريخ الميلادي', formatDateOnly(meetingDateValue, zone), 'ltr'],
        ['التاريخ الهجري', formatHijriDate(meetingDateValue, zone), 'rtl'],
        ['الساعة', formatTimeOnly(meetingDateValue, zone), 'ltr'],
        ['وقت الرصد التلقائي', formatTimeOnly(observationAt, zone), 'ltr'],
        ['وقت البداية الفعلية', formatTimeOnly(meeting.started_at, zone), 'ltr'],
        ['وقت النهاية', formatTimeOnly(meeting.ended_at, zone), 'ltr'],
        ['مدة الاجتماع', formatDuration(duration), 'ltr'],
        ['القناة الصوتية', voiceChannelName || '—', voiceChannelName && hasArabic(voiceChannelName) ? 'rtl' : 'ltr'],
        ['طريقة البدء', startModeLabel(meeting.start_mode), 'rtl'],
      ]),

      sectionTitle('ملخص الحضور'),
      arP('يعتمد تصنيف الحضور على نسبة مدة حضور العضو من مدة الاجتماع الفعلية، وليس على عدد دقائق ثابت؛ لذلك يعمل بنفس المنطق في الاجتماعات القصيرة والطويلة.', {
        size: 18,
        color: GRAY,
        after: 70,
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: true,
        columnWidths: [2325, 2325, 2325, 2325],
        borders: thinBorders,
        rows: [
          new TableRow({ cantSplit: true, children: [
            summaryCell('نسبة الحضور', `${summary.attendanceRate}%`),
            summaryCell('الغائبون', String(summary.absent)),
            summaryCell('الحاضرون', String(summary.attended)),
            summaryCell('المتوقعون', String(summary.expected)),
          ] }),
          new TableRow({ cantSplit: true, children: [
            summaryCell('حضور قصير', String(summary.short)),
            summaryCell('حضور جزئي', String(summary.partial)),
            summaryCell('حضور كامل', String(summary.full)),
            summaryCell('متأخر', String(summary.late)),
          ] }),
          new TableRow({ cantSplit: true, children: [
            summaryCell('مرات الدخول', String(summary.joins)),
            summaryCell('في الموعد', String(summary.onTime)),
            summaryCell('مبكر', String(summary.early)),
            summaryCell('مدة الاجتماع', formatDuration(duration)),
          ] }),
        ],
      }),

      sectionTitle('كشف الحضور'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: true,
        columnWidths: [650, 2750, 1250, 1500, 1500, 1650],
        borders: thinBorders,
        rows: [
          new TableRow({
            tableHeader: true,
            cantSplit: true,
            children: [
              ltrCell('#', { fill: DARK, color: WHITE, bold: true, size: 16 }),
              arCell('الاسم', { fill: GOLD, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('الحالة', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('الوصول', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('المدة', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('التغطية', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
            ],
          }),
          ...rows.map((row, index) => {
            const fill = statusFill(row);
            return new TableRow({
              cantSplit: true,
              children: [
                ltrCell(String(index + 1), { size: 17 }),
                smartCell(row.display_name, { bold: true, size: 18 }),
                arCell(attendanceDisplayLabel(row), { fill, bold: true, center: true, size: 17 }),
                arCell(arrivalLabel(row, meeting.scheduled_at), { fill: WHITE, center: true, size: 17 }),
                ltrCell(formatDuration(row.total_seconds || 0), { size: 17 }),
                ltrCell(coverageLabel(row), { size: 17 }),
              ],
            });
          }),
        ],
      }),
    );

    if (approvedExcuses.length) {
      children.push(
        sectionTitle('الاعتذارات المقبولة'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          visuallyRightToLeft: true,
          columnWidths: [2600, 4200, 2500],
          borders: thinBorders,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: [
              arCell('الاسم', { fill: GOLD, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('سبب الاعتذار', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('وقت التقديم', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
            ] }),
            ...approvedExcuses.map((ex) => new TableRow({ cantSplit: true, children: [
              smartCell(ex.member_name, { bold: true, size: 18 }),
              arCell(ex.reason || '—', { size: 18 }),
              ltrCell(formatDateTime(ex.submitted_at, zone), { size: 17 }),
            ] })),
          ],
        }),
      );
    }

    if (decisions.length) {
      const decisionStatus = { open: 'مفتوح', in_progress: 'قيد التنفيذ', implemented: 'تم التنفيذ', cancelled: 'ملغي' };
      const decisionPriority = { low: 'منخفضة', normal: 'عادية', high: 'عالية', critical: 'حرجة' };
      children.push(sectionTitle('القرارات والالتزامات'), spacer(45));
      decisions.forEach((decision, index) => {
        children.push(
          decisionCard({
            number: index + 1,
            text: decision.decision_text,
            status: decisionStatus[decision.status] || decision.status || 'مفتوح',
            priority: decisionPriority[decision.priority] || decision.priority || 'عادية',
            owner: decision.owner_name || decision.owner_user_id || 'غير معيّن',
            due: formatDecisionDue(decision.due_at, zone),
            evidence: decision.evidence || '',
          }),
          spacer(45),
        );
      });
    }

    if (tasks.length) {
      const taskStatus = { pending: 'لم يبدأ', in_progress: 'قيد التنفيذ', done: 'مكتمل', cancelled: 'ملغي' };
      const taskState=(task)=>task.review_status === 'submitted' ? 'بانتظار المراجعة' : task.review_status === 'rejected' ? 'أعيد للتعديل' : taskStatus[task.status] || task.status || '—';
      const grouped=new Map();const reportTasks=[];
      for(const task of tasks){
        if(!task.assignment_group_id){reportTasks.push({title:task.title||'—',assignee:task.assignee_name||task.assignee_user_id||'—',dueAt:task.due_at,status:taskState(task),allDone:task.status==='done',hasRejected:task.review_status==='rejected',hasSubmitted:task.review_status==='submitted'});continue;}
        const key=String(task.assignment_group_id);const entry=grouped.get(key)??{title:task.title||'—',mode:task.assignment_mode,targetTeamName:task.assignment_target_team_name||'',dueAt:task.due_at,tasks:[]};entry.tasks.push(task);grouped.set(key,entry);
      }
      for(const entry of grouped.values()){
        const done=entry.tasks.filter(t=>t.status==='done').length;
        const submitted=entry.tasks.filter(t=>t.review_status==='submitted').length;
        const rejected=entry.tasks.filter(t=>t.review_status==='rejected').length;
        const progress=entry.tasks.filter(t=>t.status==='in_progress'&&t.review_status!=='submitted'&&t.review_status!=='rejected').length;
        const pending=entry.tasks.filter(t=>t.status==='pending').length;
        const cancelled=entry.tasks.filter(t=>t.status==='cancelled').length;
        const names=entry.tasks.map(t=>String(t.assignee_name||t.assignee_user_id));
        const assignee=entry.mode==='team'?`فريق ${entry.targetTeamName} كاملًا (${entry.tasks.length})`:`${names.slice(0,5).join('، ')}${names.length>5?` +${names.length-5}`:''}`;
        const statusParts=[`مكتمل ${done}/${entry.tasks.length}`];if(progress)statusParts.push(`قيد التنفيذ ${progress}`);if(submitted)statusParts.push(`مراجعة ${submitted}`);if(rejected)statusParts.push(`تعديل ${rejected}`);if(pending)statusParts.push(`لم يبدأ ${pending}`);if(cancelled)statusParts.push(`ملغي ${cancelled}`);
        reportTasks.push({title:entry.title,assignee,dueAt:entry.dueAt,status:statusParts.join(' • '),allDone:done===entry.tasks.length,hasRejected:rejected>0,hasSubmitted:submitted>0});
      }
      children.push(
        sectionTitle('التكليفات والمتابعة'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          visuallyRightToLeft: true,
          columnWidths: [3200, 2200, 2200, 1700],
          borders: thinBorders,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: [
              arCell('التكليف', { fill: GOLD, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('المكلّف', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('الموعد النهائي', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
              arCell('الحالة', { fill: DARK, color: WHITE, bold: true, center: true, size: 16 }),
            ] }),
            ...reportTasks.map((task) => new TableRow({ cantSplit: true, children: [
              arCell(task.title, { bold: true, size: 18 }),
              smartCell(task.assignee, { size: 18 }),
              ltrCell(formatDateTime(task.dueAt, zone), { size: 17 }),
              arCell(task.status, {
                center: true,
                fill: task.hasRejected ? RED : task.hasSubmitted ? AMBER : task.allDone ? GREEN : task.dueAt && new Date(task.dueAt) < new Date() ? AMBER : WHITE,
                size: 17,
              }),
            ] })),
          ],
        }),
      );
    }

    if (decisions.length > 0 || tasks.length > 0) {
      children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    }

    children.push(
      sectionTitle('التسجيل والأرشفة'),
      twoColumnTable([
        ['التسجيل الصوتي', settings?.recording_enabled ? 'مفعّل' : 'معطّل', 'rtl'],
        ['حالة التسجيل', recording ? ({ recording: 'جاري', completed: 'مكتمل', failed: 'فشل' }[recording.status] || recording.status) : 'لا يوجد تسجيل', 'rtl'],
        ['المقاطع المحفوظة', tracks.length, 'ltr'],
        ['حالة الاجتماع', meetingStatusLabel(meeting.status), 'rtl'],
        ['سبب الإنهاء', meeting.end_reason || meeting.cancel_reason || meeting.postpone_note || '—', 'rtl'],
        ['حالة التقرير', 'تم الإنشاء والأرشفة', 'rtl'],
        ['التسليم', 'جاهز للتسليم حسب إعدادات المستلمين والصلاحيات', 'rtl'],
      ]),
      spacer(70),
      sectionTitle('ملاحظات الاجتماع'),
      arP(meeting.summary || meeting.description || 'لا توجد ملاحظات مسجلة للاجتماع.', { color: GRAY, size: 18, after: 55 }),
      noteBox('هذا تقرير رسمي يُنشأ تلقائيًا من سجلات الاجتماع والحضور والاعتذارات والقرارات والتكليفات والتسجيل، وتبقى التعديلات الإدارية محفوظة في سجل التدقيق.'),
    );

    const doc = new Document({
      creator: 'Meeting 967',
      title: reportTitle,
      description: 'Meeting 967 official meeting report',
      styles: {
        default: {
          document: {
            run: { font: FONT, size: 20, color: DARK },
            paragraph: { spacing: { line: 260 } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 737, right: 709, bottom: 737, left: 709 },
          },
        },
        children,
        footers: {
          default: new Footer({
            children: [ltrP('Meeting 967  •  تقرير رسمي آلي', { color: '777777', size: 15, alignment: AlignmentType.CENTER })],
          }),
        },
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const dir = path.resolve(this.env.STORAGE_DIR, 'reports', String(guildId));
    await fs.mkdir(dir, { recursive: true });

    const filename = `${safeFilePart(reportTitle)}.docx`;
    const file = path.join(dir, filename);
    await fs.writeFile(file, buffer);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const report = await this.reports.add({
      meetingId,
      actorId,
      path: file,
      sha256,
      metadata: {
        template: 'official-967-v6-approved-layout',
        filename,
        reportTitle,
        meetingNumber,
        meetingDay: formatDayName(meetingDateValue, zone),
        gregorianDate: formatDateOnly(meetingDateValue, zone),
        hijriDate: formatHijriDate(meetingDateValue, zone),
        meetingTime: formatTimeOnly(meetingDateValue, zone),
        expected: summary.expected,
        attended: summary.attended,
        absent: summary.absent,
        excused: summary.excused,
        recordingTracks: tracks.length,
        tasks: tasks.length,
        taskGroups: new Set(tasks.filter(t=>t.assignment_group_id).map(t=>String(t.assignment_group_id))).size,
        decisions: decisions.length,
      },
    });

    return report;
  }
}