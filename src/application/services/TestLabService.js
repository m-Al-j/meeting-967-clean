import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ACTIVE = new Set(['starting', 'active', 'ending']);

function asPaths(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {}
    return [value];
  }
  return [];
}

async function fileBytes(file) {
  try { return Number((await fs.stat(file)).size || 0); } catch { return 0; }
}

function compactError(error) {
  return String(error?.message ?? error ?? 'خطأ غير معروف').slice(0, 3000);
}

export class TestLabService {
  constructor({ db, meetings, teams, guilds, attendanceService, reportService, recordingService, env, logger }) {
    Object.assign(this, { db, meetings, teams, guilds, attendanceService, reportService, recordingService, env, logger });
  }

  async visible(guildId) {
    const { rows } = await this.db.query(
      `SELECT visible FROM meeting967_test_lab_settings WHERE guild_id=$1`,
      [guildId],
    );
    return rows[0]?.visible !== false;
  }

  async setVisible(guildId, visible) {
    await this.db.query(
      `INSERT INTO meeting967_test_lab_settings(guild_id,visible,updated_at)
       VALUES($1,$2,now())
       ON CONFLICT(guild_id) DO UPDATE SET visible=EXCLUDED.visible,updated_at=now()`,
      [guildId, Boolean(visible)],
    );
  }

  async active(guildId) {
    const { rows } = await this.db.query(
      `SELECT * FROM meeting967_test_lab_runs
       WHERE guild_id=$1 AND status = ANY($2::text[])
       ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [guildId, [...ACTIVE]],
    );
    return rows[0] ?? null;
  }

  async recent(guildId, limit = 8) {
    const { rows } = await this.db.query(
      `SELECT * FROM meeting967_test_lab_runs
       WHERE guild_id=$1
       ORDER BY created_at DESC LIMIT $2`,
      [guildId, Math.max(1, Math.min(20, Number(limit) || 8))],
    );
    return rows;
  }

  async latestCompleted(guildId) {
    const { rows } = await this.db.query(
      `SELECT * FROM meeting967_test_lab_runs
       WHERE guild_id=$1 AND status IN ('completed','failed')
       ORDER BY ended_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [guildId],
    );
    return rows[0] ?? null;
  }

  async start({ guild, actorId, actorDisplayName = null, teamId, voiceChannelId, testScope = null }) {
    const guildId = String(guild.id);
    const existing = await this.active(guildId);
    if (existing) throw new Error('يوجد اختبار جارٍ بالفعل. أنهِه أولًا.');

    // test-lab-v1.9.3:safety — never compete with a real meeting or one about to start.
    const { rows: realRunning } = await this.db.query(
      `SELECT m.name,t.name AS team_name FROM meetings m
       JOIN teams t ON t.id=m.team_id
       WHERE m.guild_id=$1 AND m.status='ongoing' AND COALESCE(m.is_test,false)=false
       ORDER BY m.started_at NULLS LAST LIMIT 1`,
      [guildId],
    );
    if (realRunning[0]) {
      const error = new Error(`يوجد اجتماع حقيقي جارٍ الآن: ${realRunning[0].name}`);
      error.code = 'REAL_MEETING_RUNNING';
      throw error;
    }

    const { rows: realSoon } = await this.db.query(
      `SELECT m.name,m.scheduled_at,t.name AS team_name FROM meetings m
       JOIN teams t ON t.id=m.team_id
       WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false
         AND m.status IN ('upcoming','postponed')
         AND m.scheduled_at BETWEEN now() AND now()+interval '10 minutes'
       ORDER BY m.scheduled_at LIMIT 1`,
      [guildId],
    );
    if (realSoon[0]) {
      const error = new Error(`يوجد اجتماع حقيقي سيبدأ خلال أقل من 10 دقائق: ${realSoon[0].name}`);
      error.code = 'REAL_MEETING_SOON';
      throw error;
    }

    const team = await this.teams.get(teamId);
    if (!team || String(team.guild_id) !== guildId || team.deleted_at) {
      throw new Error('الفريق المختار غير موجود أو لا يتبع هذا السيرفر.');
    }

    // test-lab-general-v1.9.5.0
    const requestedTestScope=String(testScope??'').trim().toLowerCase();
    const isGeneralTest=requestedTestScope==='general';
    const testDisplayName=isGeneralTest?'الاجتماعات العامة':team.name;

    const channel = guild.channels.cache.get(String(voiceChannelId))
      ?? await guild.channels.fetch(String(voiceChannelId)).catch(() => null);
    if (!channel?.isVoiceBased?.()) throw new Error('القناة المختارة ليست قناة صوتية صالحة.');

    const { rows: occupiedRows } = await this.db.query(
      `SELECT id,name FROM meetings
       WHERE guild_id=$1 AND voice_channel_id=$2 AND status='ongoing'
       ORDER BY started_at DESC LIMIT 1`,
      [guildId, String(voiceChannelId)],
    );
    if (occupiedRows[0]) throw new Error(`القناة مستخدمة الآن بواسطة اجتماع جارٍ: ${occupiedRows[0].name}`);

    const runId = randomUUID();
    const meetingId = randomUUID();
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const meetingName = `تجربة تسجيل — ${testDisplayName} — ${stamp}`.slice(0, 120);

    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `INSERT INTO meetings(
           id,guild_id,team_id,name,description,scheduled_at,original_scheduled_at,
           voice_channel_id,status,created_by,updated_by,is_test,start_mode
         ) VALUES($1,$2,$3,$4,$5,$6,$6,$7,'ongoing',$8,$8,true,'manual')`,
        [
          meetingId, guildId, team.id, meetingName,
          'Meeting 967 Test Lab — اجتماع تجريبي معزول لا يدخل في السجلات الحقيقية.',
          now, String(voiceChannelId), String(actorId),
        ],
      );

      await this.db.query(
        `UPDATE meetings SET started_at=$2 WHERE id=$1`,
        [meetingId, now],
      );

      // test-lab-v1.9.4.1:real-participants-at-start
      // Actual human participants are snapshotted from the selected voice channel below.

      await this.db.query(
        `INSERT INTO meeting967_test_lab_runs(
           id,guild_id,meeting_id,team_id,team_name,voice_channel_id,status,started_at,metadata
         ) VALUES($1,$2,$3,$4,$5,$6,'starting',$7,$8::jsonb)`,
        [
          runId, guildId, meetingId, team.id, testDisplayName, String(voiceChannelId), now,
          JSON.stringify({ ownerUserId: String(actorId), isolation: 'zero-outbound', testScope:requestedTestScope||null, backingTeamId:String(team.id) }),
        ],
      );
      await this.db.query('COMMIT');
    } catch (error) {
      await this.db.query('ROLLBACK').catch(() => {});
      throw error;
    }

    let meeting = await this.meetings.get(meetingId);

    // test-lab-v1.9.3.8:strict-worker-scope
    const testTeamName=String(team.name ?? '').trim();
    const testWorkerScope=
      isGeneralTest
        ? 'general'
        : testTeamName.includes('الموارد البشرية') || testTeamName.includes('موارد بشرية')
        ? 'hr'
        : (testTeamName.includes('الإعلام') || testTeamName.includes('اعلام'))
          ? 'media'
          : (
              testTeamName.includes('الفريق التنفيذي') ||
              testTeamName.includes('التنفيذي') ||
              testTeamName.includes('تنفيذي')
            )
            ? 'executive'
            : (
                testTeamName.includes('الإدارة والحوكمة') ||
                testTeamName.includes('الاداره والحوكمة') ||
                testTeamName.includes('الإدارة') ||
                testTeamName.includes('الادارة') ||
                testTeamName.includes('الحوكمة')
              )
            ? 'governance'
            : (
                testTeamName.includes('التقنية والبحث') ||
                testTeamName.includes('التقنية') ||
                testTeamName.includes('البحث') ||
                testTeamName.includes('البيانات')
              )
            ? 'tech'
            : null;

    // executive-worker-v1.9.4.0:test-scope

    meeting={
      ...meeting,
      team_name:testDisplayName,
      ...(testWorkerScope ? {test_worker_scope:testWorkerScope} : {}),
    };

    // test-lab-v1.9.4.1:seed-current-humans
    const testHumans=[...channel.members.values()].filter((member)=>!member.user?.bot);

    for(const member of testHumans){
      const displayName=String(
        member.displayName ??
        member.user?.globalName ??
        member.user?.username ??
        member.id
      ).slice(0,200);

      await this.db.query(
        `INSERT INTO meeting_member_snapshots(meeting_id,user_id,display_name,team_id)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(meeting_id,user_id) DO NOTHING`,
        [meetingId,String(member.id),displayName,team.id],
      );

      await this.db.query(
        `INSERT INTO attendance(meeting_id,user_id,status)
         VALUES($1,$2,'absent')
         ON CONFLICT(meeting_id,user_id) DO NOTHING`,
        [meetingId,String(member.id)],
      );

      // Already present in voice: open attendance immediately.
      await this.attendanceService.joined(meeting,String(member.id),now);
    }

    try {
      const recording = await this.recordingService.start({ meeting, guild, actorId, recovery: false });
      const state = this.recordingService.active.get(meetingId);
      const recorderKey = String(state?.recorderKey ?? 'unknown');
      const recorderUserId = String(state?.voiceGuild?.client?.user?.id ?? state?.guild?.client?.user?.id ?? '');

      await this.db.query(
        `UPDATE meeting967_test_lab_runs
         SET status='active', recorder_key=$2, recorder_user_id=NULLIF($3,'')::bigint,
             recording_root=$4, updated_at=now()
         WHERE id=$1`,
        [runId, recorderKey, recorderUserId, recording?.storage_path ?? null],
      );

      return await this.get(runId);
    } catch (error) {
      await this.db.query(
        `UPDATE meeting967_test_lab_runs SET status='failed',error=$2,ended_at=now(),updated_at=now() WHERE id=$1`,
        [runId, compactError(error)],
      ).catch(() => {});
      await this.db.query(`DELETE FROM meetings WHERE id=$1`, [meetingId]).catch(() => {});
      throw error;
    }
  }

  async end({ guild, actorId }) {
    const guildId = String(guild.id);
    const run = await this.active(guildId);
    if (!run) throw new Error('لا يوجد اختبار جارٍ الآن.');

    // test-lab-v1.9.3.8:idempotent-end
    if (run.status === 'ending') return await this.get(run.id);

    await this.db.query(
      `UPDATE meeting967_test_lab_runs SET status='ending',updated_at=now() WHERE id=$1`,
      [run.id],
    );

    const errors = [];
    let report = null;
    let recording = null;
    let meeting = await this.meetings.get(run.meeting_id);
    const endedAt = new Date();

    try {
      if (meeting) {
        const settings = await this.guilds.getSettings(guildId);
        await this.attendanceService.finalize(meeting, settings, endedAt).catch((error) => {
          errors.push(`attendance: ${compactError(error)}`);
        });

        meeting = await this.meetings.update(
          meeting.id,
          { status: 'ended', ended_at: endedAt, end_reason: 'test_lab' },
          actorId,
        );

        recording = await this.recordingService.stopByMeeting(meeting.id).catch((error) => {
          errors.push(`recording: ${compactError(error)}`);
          return null;
        });

        if (!recording) {
          await this.db.query(
            `UPDATE recordings SET status='failed',stopped_at=COALESCE(stopped_at,now()),
                    metadata=metadata || '{"testLabClosedAfterRestart":true}'::jsonb
             WHERE meeting_id=$1 AND status='recording'`,
            [meeting.id],
          ).catch(() => {});
          const { rows } = await this.db.query(
            `SELECT * FROM recordings WHERE meeting_id=$1 ORDER BY started_at DESC LIMIT 1`,
            [meeting.id],
          );
          recording = rows[0] ?? null;
        }

        report = await this.reportService.generate({ guildId, meetingId: meeting.id, actorId, guild }).catch((error) => {
          errors.push(`report: ${compactError(error)}`);
          return null;
        });
      } else {
        errors.push('meeting: السجل التجريبي المؤقت غير موجود.');
      }

      const { rows: recordingRows } = await this.db.query(
        `SELECT storage_path,final_paths FROM recordings WHERE meeting_id=$1 ORDER BY started_at`,
        [run.meeting_id],
      ).catch(() => ({ rows: [] }));

      const recordingPaths = [...new Set(recordingRows.flatMap((r) => asPaths(r.final_paths)))];
      const recordingRoots = [...new Set(recordingRows.map((r) => r.storage_path).filter(Boolean).map(String))];
      if (!recordingPaths.length && recording) recordingPaths.push(...asPaths(recording.final_paths));
      const reportPath = report?.path ? String(report.path) : null;
      const reportBytes = reportPath ? await fileBytes(reportPath) : 0;
      let recordingBytes = 0;
      for (const file of recordingPaths) recordingBytes += await fileBytes(file);

      const status = reportPath || recordingPaths.length ? 'completed' : 'failed';
      await this.db.query(
        `UPDATE meeting967_test_lab_runs
         SET status=$2, ended_at=$3, report_path=$4, report_bytes=$5,
             recording_paths=$6::jsonb, recording_bytes=$7,
             recording_roots=$8::jsonb, error=$9, updated_at=now()
         WHERE id=$1`,
        [
          run.id, status, endedAt, reportPath, reportBytes,
          JSON.stringify(recordingPaths), recordingBytes,
          JSON.stringify(recordingRoots), errors.length ? errors.join(' | ').slice(0, 3000) : null,
        ],
      );
    } finally {
      await this.db.query(`DELETE FROM meetings WHERE id=$1 AND is_test=true`, [run.meeting_id]).catch(() => {});
    }

    return await this.get(run.id);
  }

  // test-lab-owner-failover-v6:testlab-service
  async forceFailover({ guildId, actorId }) {
    const run=await this.active(String(guildId));
    if(!run)throw new Error('لا يوجد اختبار جارٍ الآن.');
    if(run.status!=='active')throw new Error('الاختبار ليس في حالة تسمح بتنفيذ Failover.');

    const metaNow=(run.metadata && typeof run.metadata==='object') ? run.metadata : {};
    if(metaNow.testFailover===true)throw new Error('تم تنفيذ Failover على هذا الاختبار مسبقًا.');

    const meeting=await this.meetings.get(run.meeting_id);
    if(!meeting || !meeting.is_test)throw new Error('تعذر التحقق من الاجتماع التجريبي.');

    const state=this.recordingService.active.get(run.meeting_id);
    if(!state)throw new Error('لا يوجد تسجيل نشط لهذا الاختبار.');
    if(state.recorderType!=='worker')throw new Error('المسجل الحالي ليس Recording Worker.');

    const result=await this.recordingService.forceTestFailover(run.meeting_id,actorId);
    const next=this.recordingService.active.get(run.meeting_id);
    const recorderKey=String(next?.recorderKey ?? result?.to?.recorderKey ?? 'unknown');
    const recorderUserId=String(
      next?.voiceGuild?.client?.user?.id ??
      next?.guild?.client?.user?.id ??
      result?.to?.recorderUserId ??
      ''
    );

    const meta={
      testFailover:true,
      testFailoverAt:new Date().toISOString(),
      testFailoverActorId:String(actorId),
      testFailoverFrom:result?.from ?? null,
      testFailoverTo:result?.to ?? null,
    };

    await this.db.query(
      `UPDATE meeting967_test_lab_runs
       SET recorder_key=$2,
           recorder_user_id=NULLIF($3,'')::bigint,
           metadata=COALESCE(metadata,'{}'::jsonb) || $4::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [run.id,recorderKey,recorderUserId,JSON.stringify(meta)],
    );

    return await this.get(run.id);
  }

  async get(runId) {
    const { rows } = await this.db.query(`SELECT * FROM meeting967_test_lab_runs WHERE id=$1`, [runId]);
    return rows[0] ?? null;
  }

  async purge(guildId) {
    const active = await this.active(guildId);
    if (active) throw new Error('أنهِ الاختبار الجاري أولًا قبل حذف بيانات التجارب.');
    const { rows: runs } = await this.db.query(`SELECT * FROM meeting967_test_lab_runs WHERE guild_id=$1 ORDER BY created_at DESC`, [guildId]);
    for (const run of runs) {
      for (const file of [run.report_path, ...asPaths(run.recording_paths)]) {
        if (!file) continue;
        await fs.rm(String(file), { force: true }).catch(() => {});
      }
      for (const root of asPaths(run.recording_roots)) {
        if (!root) continue;
        await fs.rm(String(root), { recursive: true, force: true }).catch(() => {});
        const parent = path.dirname(String(root));
        await fs.rmdir(parent).catch(() => {});
      }
      if (run.meeting_id) {
        await this.db.query(`DELETE FROM meetings WHERE id=$1 AND is_test=true`, [run.meeting_id]).catch(() => {});
      }
    }
    const { rowCount } = await this.db.query(`DELETE FROM meeting967_test_lab_runs WHERE guild_id=$1`, [guildId]);
    return { removed: Number(rowCount || 0) };
  }

  recorderLabel(run) {
    const key = String(run?.recorder_key ?? '');
    const m = key.match(/^worker:(\d+):/);
    if (m) return `Worker ${m[1]}`;
    if (key.startsWith('main:')) return 'البوت الأساسي';
    if (!key || key === 'unknown') return 'غير معروف';
    return key;
  }
}
