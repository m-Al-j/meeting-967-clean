import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ReportService } from '../src/application/services/ReportService.js';

const iso = (s) => new Date(s).toISOString();

test('approved report layout source keeps the exact institutional sections and RTL safeguards', () => {
  const source = fs.readFileSync(new URL('../src/application/services/ReportService.js', import.meta.url), 'utf8');
  for (const token of [
    "const FONT = 'Arial'",
    'rightToLeft: true',
    'bidirectional: true',
    "sectionTitle('بيانات الاجتماع')",
    "sectionTitle('ملخص الحضور')",
    "sectionTitle('كشف الحضور')",
    "sectionTitle('الاعتذارات المقبولة')",
    "sectionTitle('القرارات والالتزامات')",
    "sectionTitle('التكليفات والمتابعة')",
    "sectionTitle('التسجيل والأرشفة')",
    "sectionTitle('ملاحظات الاجتماع')",
    "template: 'official-967-v6-approved-layout'",
    "size: { width: 11906, height: 16838 }",
    'decisionCard({',
    'attendanceDisplayLabel(row)',
    'noteBox(',
  ]) assert.ok(source.includes(token), `missing ${token}`);

  assert.ok(!source.includes("sectionTitle('تفاصيل الدخول للحاضرين')"), 'approved layout must stay compact like the accepted sample');
  assert.ok(source.indexOf("sectionTitle('القرارات والالتزامات')") < source.indexOf("sectionTitle('التسجيل والأرشفة')"));
  assert.ok(source.indexOf("sectionTitle('التكليفات والمتابعة')") < source.indexOf("sectionTitle('التسجيل والأرشفة')"));
});

test('ReportService really packs an Arabic DOCX with the approved layout before installation is accepted', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'meeting967-report-v1101-'));
  try {
    const meetingId = 'm-12';
    const meeting = {
      id: meetingId,
      guild_id: 'g-1',
      team_name: 'الإدارة والحوكمة',
      name: 'اجتماع التخطيط التشغيلي',
      status: 'ended',
      scheduled_at: iso('2026-08-29T17:00:00Z'),
      started_at: iso('2026-08-29T17:00:00Z'),
      ended_at: iso('2026-08-29T18:18:00Z'),
      start_mode: 'autopilot',
      voice_channel_id: 'voice-1',
      end_reason: 'انتهى تلقائيًا بعد مغادرة آخر عضو',
      summary: 'ناقش الفريق جاهزية منصة العضوية وتحديثات الهوية المؤسسية وآلية تسليم واستلام المسؤوليات.',
    };

    const rows = [
      { display_name: 'محمد العريقي', status: 'present', first_join_at: iso('2026-08-29T16:57:00Z'), last_leave_at: iso('2026-08-29T18:18:00Z'), total_seconds: 4680, presence_ratio: 1, full_attendance: true, join_count: 1 },
      { display_name: 'أحمد سالم', status: 'present', first_join_at: iso('2026-08-29T17:00:00Z'), last_leave_at: iso('2026-08-29T18:16:00Z'), total_seconds: 4560, presence_ratio: 0.97, full_attendance: true, join_count: 1 },
      { display_name: 'عبدالله حسن', status: 'late', first_join_at: iso('2026-08-29T17:16:00Z'), last_leave_at: iso('2026-08-29T18:18:00Z'), total_seconds: 3720, presence_ratio: 0.79, full_attendance: false, join_count: 2 },
      { display_name: 'موسى يحيى', status: 'present', first_join_at: iso('2026-08-29T17:00:00Z'), last_leave_at: iso('2026-08-29T17:49:00Z'), total_seconds: 2940, presence_ratio: 0.63, full_attendance: false, join_count: 1 },
      { display_name: 'رامي صالح', status: 'excused', first_join_at: null, last_leave_at: null, total_seconds: 0, presence_ratio: 0, full_attendance: false, join_count: 0 },
    ];

    const decisions = [
      { decision_text: 'اعتماد إطلاق النسخة التجريبية من منصة العضوية بعد إنهاء اختبارات الصلاحيات.', status: 'in_progress', priority: 'high', owner_name: 'أحمد سالم', due_at: iso('2026-09-03T15:00:00Z'), evidence: null },
      { decision_text: 'توحيد جميع نماذج التقارير الرسمية للفرق تحت الهوية المؤسسية الجديدة.', status: 'implemented', priority: 'normal', owner_name: 'ليان محمد', due_at: iso('2026-08-31T17:00:00Z'), evidence: 'تم رفع القالب النهائي إلى مجلد الإدارة.' },
      { decision_text: 'إعداد خطة تسليم واستلام للمهام الإدارية قبل تغيير أي مسؤول فريق.', status: 'open', priority: 'critical', owner_name: 'عبدالله حسن', due_at: iso('2026-09-01T14:00:00Z'), evidence: null },
    ];

    const tasks = [
      { title: 'اختبار صلاحيات منصة العضوية', assignee_name: 'أحمد سالم', assignee_user_id: 'u-2', due_at: iso('2026-09-02T15:00:00Z'), status: 'in_progress', review_status: null, assignment_group_id: null },
      { title: 'إعداد النسخة النهائية من دليل الهوية', assignee_name: 'ليان محمد', assignee_user_id: 'u-3', due_at: iso('2026-08-31T17:00:00Z'), status: 'done', review_status: null, assignment_group_id: null },
    ];

    let savedMeta = null;
    const service = new ReportService({
      meetings: {
        get: async () => meeting,
        decisions: async () => decisions,
        ordinal: async () => 12,
      },
      attendance: { reportRows: async () => rows },
      reports: {
        add: async (payload) => {
          savedMeta = payload.metadata;
          return { id: 'r-1', ...payload };
        },
      },
      guilds: { getSettings: async () => ({ timezone: 'Asia/Aden', recording_enabled: true }) },
      recordings: {
        latestForMeeting: async () => ({ id: 'rec-1', status: 'completed' }),
        tracks: async () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      },
      excuses: {
        approvedForMeeting: async () => [{ member_name: 'رامي صالح', reason: 'ظرف عائلي طارئ', submitted_at: iso('2026-08-29T11:25:00Z') }],
      },
      tasks: { listForMeeting: async () => tasks },
      env: { STORAGE_DIR: tmp },
    });

    const guild = { channels: { fetch: async () => ({ name: 'غرفة الإدارة والحوكمة' }) } };
    const report = await service.generate({ guildId: 'g-1', meetingId, actorId: 'owner-1', guild });

    const stat = await fsp.stat(report.path);
    assert.ok(stat.size > 15_000, `DOCX unexpectedly small: ${stat.size}`);
    const packed = await fsp.readFile(report.path);
    const signature = packed.subarray(0, 4).toString('hex');
    assert.equal(signature, '504b0304', 'DOCX must be a valid ZIP/OOXML package');
    const zip = await JSZip.loadAsync(packed);
    const xml = await zip.file('word/document.xml').async('string');
    for (const token of ['تقرير الاجتماع الرسمي', 'حضور جزئي', 'القرارات والالتزامات', 'التكليفات والمتابعة', 'التسجيل والأرشفة', 'ملاحظات الاجتماع', 'دليل التنفيذ']) {
      assert.ok(xml.includes(token), `generated OOXML missing ${token}`);
    }
    assert.ok(xml.includes('w:bidi'), 'generated OOXML must contain RTL paragraph markers');
    assert.ok(xml.includes('w:rtl'), 'generated OOXML must contain RTL run markers');
    assert.equal(savedMeta?.template, 'official-967-v6-approved-layout');
    assert.equal(savedMeta?.decisions, 3);
    assert.equal(savedMeta?.recordingTracks, 3);
    assert.ok(path.basename(report.path).includes('اجتماع التخطيط التشغيلي'));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
