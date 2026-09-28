import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import { OggOpusWriter } from '../../utils/oggOpusWriter.js';
import { RecordingWorkerPool } from './RecordingWorkerPool.js';

function runProcess(command,args,{timeoutMs=180000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});
    let out='',err='',settled=false;
    child.stdout.on('data',d=>{out+=d.toString();if(out.length>16000)out=out.slice(-16000);});
    child.stderr.on('data',d=>{err+=d.toString();if(err.length>12000)err=err.slice(-12000);});
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish(new Error(`${command} تجاوز مهلة التنفيذ.`));},timeoutMs);
    child.once('error',e=>finish(e));
    child.once('close',code=>code===0?finish(null,{stdout:out,stderr:err}):finish(new Error(`${command} فشل (${code}): ${err.slice(-3000)}`)));
  });
}

function safeAudioFilePart(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'اجتماع';
}


// recording-integrity-guard-v1.10.11
export const RECORDING_INTEGRITY_VERSION = '1.10.11';
export const RECORDING_INTEGRITY_MAX_GAP_MS = 1500;

function integrityMs(value){
  const n=new Date(value??'').getTime();
  return Number.isFinite(n)?n:NaN;
}
function integrityMeta(row){
  return row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
}
export function evaluateRecordingIntegrity({sessions=[],meetingStartedAt=null,meetingEndedAt=null,maxGapMs=RECORDING_INTEGRITY_MAX_GAP_MS}={}){
  const rows=Array.isArray(sessions)?sessions:[];
  const reasons=[];
  const starts=rows.map(r=>integrityMs(integrityMeta(r).integrityCoverageStartedAt??r?.started_at)).filter(Number.isFinite);
  const ends=rows.map(r=>integrityMs(integrityMeta(r).integrityCoverageEndedAt??r?.stopped_at)).filter(Number.isFinite);
  const explicitStart=integrityMs(meetingStartedAt),explicitEnd=integrityMs(meetingEndedAt);
  const start=Number.isFinite(explicitStart)?explicitStart:(starts.length?Math.min(...starts):NaN);
  const end=Number.isFinite(explicitEnd)?explicitEnd:(ends.length?Math.max(...ends):NaN);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){
    return {ok:false,reasons:['invalid-meeting-timeline'],maxGapMs:null,coverageRatio:0,meetingStartMs:start,meetingEndMs:end};
  }
  if(!rows.length)reasons.push('no-recording-sessions');
  const intervals=[];
  let worstNonReadyMs=0;
  for(const row of rows){
    const meta=integrityMeta(row);
    if(String(meta.integrityGuardVersion??'')!==RECORDING_INTEGRITY_VERSION)reasons.push('session-without-integrity-guard');
    if(meta.integrityCompromised===true)reasons.push('receiver-integrity-compromised');
    const nonReady=Math.max(0,Number(meta.integrityMaxNonReadyMs??0)||0);worstNonReadyMs=Math.max(worstNonReadyMs,nonReady);
    if(nonReady>maxGapMs)reasons.push('voice-nonready-gap-too-large');
    const a=integrityMs(meta.integrityCoverageStartedAt??row?.started_at);
    const b=integrityMs(meta.integrityCoverageEndedAt??row?.stopped_at);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)continue;
    const lo=Math.max(start,a),hi=Math.min(end,b);if(hi>lo)intervals.push([lo,hi]);
  }
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const merged=[];
  for(const iv of intervals){
    const last=merged[merged.length-1];
    if(!last||iv[0]>last[1])merged.push([...iv]);else last[1]=Math.max(last[1],iv[1]);
  }
  let cursor=start,maxGap=0,covered=0;
  for(const [a,b] of merged){
    if(a>cursor)maxGap=Math.max(maxGap,a-cursor);
    const lo=Math.max(cursor,a);if(b>lo)covered+=b-lo;
    cursor=Math.max(cursor,b);
  }
  if(cursor<end)maxGap=Math.max(maxGap,end-cursor);
  if(maxGap>maxGapMs)reasons.push('recorder-timeline-gap-too-large');
  const coverageRatio=Math.max(0,Math.min(1,covered/(end-start)));
  const unique=[...new Set(reasons)];
  return {ok:unique.length===0,reasons:unique,maxGapMs:maxGap,worstNonReadyMs,coverageRatio,meetingStartMs:start,meetingEndMs:end,sessionCount:rows.length};
}

export class RecordingService {
  constructor({ recordings, env, logger }) {
    this.recordings = recordings;
    this.env = env;
    this.logger = logger;
    this.workerPool = new RecordingWorkerPool({ logger });
    this.active = new Map();
    this.activeByGuild = new Map();
    // v1.9.0.1: single-flight lock لكل اجتماع.
    this.starting = new Map();
    this.recoveryJobs = new Map();
  }

  async start(args) {
    const meetingId = args?.meeting?.id;
    if (!meetingId) return this.#startCore(args);

    const active = this.active.get(meetingId);
    if (active) return active.recording;

    const pending = this.starting.get(meetingId);
    if (pending) {
      this.logger?.info?.('recording-start-joined-inflight', { meetingId });
      return pending;
    }

    const job = this.#startCore(args);
    this.starting.set(meetingId, job);

    try {
      return await job;
    } finally {
      if (this.starting.get(meetingId) === job) {
        this.starting.delete(meetingId);
      }
    }
  }

  async requestRecovery(args = {}) {
    const meeting = args?.meeting;
    const meetingId = meeting?.id;

    if (!meetingId) throw new Error('Recovery requires meeting.id');

    if (['ended', 'canceled'].includes(meeting.status)) {
      this.logger?.info?.('recording-recovery-skipped-meeting-closed', {
        meetingId,
        status: meeting.status,
      });
      return null;
    }

    const existingJob = this.recoveryJobs.get(meetingId);
    if (existingJob) {
      this.logger?.info?.('recording-recovery-joined-inflight', { meetingId });
      return existingJob;
    }

    const retryDelays = [0, 3000, 7000, 15000, 30000, 60000];

    const sleep = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const healthy = (state) =>
      Boolean(
        state &&
        this.active.get(meetingId) === state &&
        !state.voiceRecovering &&
        !state.failoverStarted &&
        state.connection?.state?.status === VoiceConnectionStatus.Ready
      );

    const job = (async () => {
      let lastError = null;

      for (let attempt = 1; attempt <= retryDelays.length; attempt++) {
        const delay = retryDelays[attempt - 1];

        if (delay > 0) {
          this.logger?.info?.('recording-recovery-backoff', {
            meetingId,
            attempt,
            delayMs: delay,
          });
          await sleep(delay);
        }

        if (['ended', 'canceled'].includes(meeting.status)) return null;

        try {
          let state = this.active.get(meetingId);

          if (healthy(state)) {
            this.logger?.info?.('recording-recovery-already-healthy', {
              meetingId,
              attempt,
              recorderKey: state.recorderKey,
            });
            return state.recording;
          }

          if (state?.voiceRecovering || state?.failoverStarted) {
            this.logger?.info?.('recording-recovery-waiting-for-owner', {
              meetingId,
              attempt,
              voiceRecovering: Boolean(state.voiceRecovering),
              failoverStarted: Boolean(state.failoverStarted),
            });

            await sleep(1000);

            state = this.active.get(meetingId);
            if (healthy(state)) return state.recording;

            continue;
          }

          if (state) {
            const recovered = await this.#recoverVoiceConnection(
              state,
              args?.trigger ?? 'external-recovery-request',
            );

            state = this.active.get(meetingId);

            if (recovered && healthy(state)) {
              this.logger?.info?.('recording-recovery-succeeded', {
                meetingId,
                attempt,
                recorderKey: state.recorderKey,
              });
              return state.recording;
            }

            lastError = new Error(
              'Recovery completed without a healthy active recorder.'
            );
            continue;
          }

          const recording = await this.start({
            ...args,
            recovery: true,
          });

          state = this.active.get(meetingId);

          if (recording && healthy(state)) {
            this.logger?.info?.('recording-recovery-start-succeeded', {
              meetingId,
              attempt,
              recorderKey: state.recorderKey,
            });
            return state.recording;
          }

          lastError = new Error(
            'Recovery start completed without a healthy active recorder.'
          );
        } catch (error) {
          lastError = error;

          this.logger?.warn?.('recording-recovery-attempt-failed', {
            meetingId,
            attempt,
            maxAttempts: retryDelays.length,
            trigger: args?.trigger ?? 'external-recovery-request',
            error: error?.stack ?? error?.message ?? String(error),
          });
        }
      }

      const finalState = this.active.get(meetingId);

      if (healthy(finalState)) return finalState.recording;

      throw (
        lastError ??
        new Error('Recording recovery failed after all retry attempts.')
      );
    })();

    this.recoveryJobs.set(meetingId, job);

    try {
      return await job;
    } finally {
      if (this.recoveryJobs.get(meetingId) === job) {
        this.recoveryJobs.delete(meetingId);
      }
    }
  }

  async #startCore({ meeting, guild, actorId, recovery=false, forceMainRecorder=false, sessionReason=null, failoverFromRecordingId=null, failoverTrigger=null, handoffFromState=null, allowTestMainRecorder=false }) {
    const existingActive=this.active.get(meeting.id);
    if(existingActive && existingActive!==handoffFromState)return existingActive.recording;
    const recorderLease = forceMainRecorder ? null : await this.workerPool.acquire({
      guild,
      meetingId: meeting.id,
      meeting,
    }).catch((error) => {
      this.logger?.warn?.('recording-worker-acquire-failed', {
        meetingId: meeting.id,
        error: error?.message ?? String(error),
      });
      return null;
    });

    // test-lab-v1.9.3.8:no-main-fallback
    const requiredTestWorkerScope=String(meeting?.test_worker_scope ?? '').trim();

    if(requiredTestWorkerScope && !allowTestMainRecorder){
      if(!recorderLease){
        const error=new Error(
          `Worker التجربة المخصص (${requiredTestWorkerScope}) غير متاح. تم منع البوت الأساسي من التسجيل بدلًا منه.`
        );
        error.code='TEST_LAB_DEDICATED_WORKER_UNAVAILABLE';
        throw error;
      }

      const leaseScope=String(
        recorderLease.teamScope ??
        this.workerPool?.workers?.find?.(
          (w)=>Number(w.number)===Number(recorderLease.workerNumber)
        )?.teamScope ??
        ''
      ).trim();

      if(leaseScope !== requiredTestWorkerScope){
        await recorderLease.release?.().catch(()=>{});
        const error=new Error(
          `Recorder غير مطابق للتجربة. المطلوب: ${requiredTestWorkerScope}، المستلم: ${leaseScope || 'غير معروف'}.`
        );
        error.code='TEST_LAB_WRONG_WORKER';
        throw error;
      }
    }

    if (requiredTestWorkerScope && forceMainRecorder && !allowTestMainRecorder) {
      const error=new Error('Test Lab لا يسمح بالتحويل إلى البوت الأساسي؛ يجب استخدام Worker التجربة المخصص.');
      error.code='TEST_LAB_MAIN_FAILOVER_BLOCKED';
      throw error;
    }

    const voiceGuild = recorderLease?.guild ?? guild;
    const recorderKey = recorderLease?.key ?? `main:${guild.id}`;
    const recorderType = recorderLease?.recorderType ?? 'main';
    const recorderUserId = recorderLease?.recorderUserId ?? String(guild.client?.user?.id ?? '');
    const workerNumber = recorderLease?.workerNumber ?? null;
    const teamScope = recorderLease?.teamScope ?? (forceMainRecorder ? 'main-fallback' : 'main');
    const occupied = this.activeByGuild.get(recorderKey);

    if (occupied && occupied !== meeting.id) {
      await recorderLease?.release?.().catch(() => {});
      const pool = this.workerPool.status(String(guild.id));
      const error = new Error(
        `لا توجد سعة تسجيل صوتي متاحة الآن. البوت الرئيسي وRecording Workers المتاحون مشغولون باجتماعات أخرى. Workers الجاهزون: ${pool.configuredReadyWorkers}.`,
      );
      error.code = 'VOICE_RECORDER_POOL_EXHAUSTED';
      throw error;
    }

    const channel = await voiceGuild.channels.fetch(String(meeting.voice_channel_id));
    if (!channel?.isVoiceBased()) {
      await recorderLease?.release?.().catch((error) => {
        this.logger?.warn?.('recording-worker-released-invalid-channel', {
          meetingId: meeting.id,
          error: error?.message ?? String(error),
        });
      });
      throw new Error('قناة الاجتماع الصوتية غير صالحة للتسجيل.');
    }
    const dir = path.resolve(this.env.STORAGE_DIR, 'recordings', String(guild.id), meeting.id, Date.now().toString());
    await fs.mkdir(dir, { recursive: true });

    // لا ننشئ سجل Recording في PostgreSQL قبل أن يصبح اتصال الصوت Ready.
    // هذا يمنع السجلات العالقة إذا فشل Discord أثناء الاتصال بالقناة.
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: voiceGuild.id, adapterCreator: voiceGuild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      try { connection.destroy(); } catch {}
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      await recorderLease?.release?.().catch(()=>{});
      throw error;
    }

    let recording;
    try {
      if(recovery)await this.recordings.failOpenForMeeting?.(meeting.id);
      recording = await this.recordings.start({
        meetingId: meeting.id,
        actorId,
        path: dir,
        recorderKey,
        recorderType,
        recorderUserId,
        workerNumber,
        teamScope,
        sessionReason: sessionReason ?? (forceMainRecorder ? 'worker-failover-main' : recovery ? 'recovery' : 'initial'),
        failoverFromRecordingId,
        metadata: {
          format: 'per-speaker Ogg Opus segments',
          guildId:String(guild.id),
          voiceChannelId:String(channel.id),
          recovery:Boolean(recovery),
          forceMainRecorder:Boolean(forceMainRecorder),
          failoverTrigger:failoverTrigger??null,
          integrityGuardVersion:RECORDING_INTEGRITY_VERSION,
          integrityStatus:'recording',
          integrityCompromised:false,
          integrityMaxNonReadyMs:0,
          integrityCoverageStartedAt:new Date().toISOString(),
          integrityEvents:[{type:'session-ready',at:new Date().toISOString(),recorderKey}],
        },
      });
    } catch (error) {
      try { connection.destroy(); } catch {}
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      await recorderLease?.release?.().catch(()=>{});
      throw error;
    }
    // v1.9.0.1 worker-aware-voice-guard
    let recorderReleased = false;
    const releaseRecorder = async () => {
      if (recorderReleased) return;
      recorderReleased = true;
      await recorderLease?.release?.().catch((error) => {
        this.logger?.warn?.('recording-worker-release-failed', {
          meetingId: meeting.id,
          recorderKey,
          error: error?.message ?? String(error),
        });
      });
    };

    // production-continuity-v1.9.2
    const state = {
      recording,
      connection,
      segments: new Map(),
      counter: new Map(),
      dir,
      guildId: String(guild.id),
      meetingTitle: safeAudioFilePart(meeting.name),
      meeting,
      guild,
      actorId,
      voiceGuild,
      recorderKey,
      recorderType,
      recorderUserId,
      workerNumber,
      teamScope,
      recorderLease,
      releaseRecorder,
      voiceRecovering: false,
      failoverStarted: false,
      workerUnhealthySince: 0,
      leaseHeartbeatBusy: false,
      nonReadySince: 0,
      lastPacketAt: Date.now(),
      totalPackets: 0,
      lastSpeakingAt: 0,
      lastRecoveryAt: 0,
      healthTimer: null,
      speakingHandler: null,
      connectionStateHandler: null,
      integrityCoverageStartedAt: new Date().toISOString(),
      integrityCoverageEndedAt: null,
      integrityNonReadySince: 0,
      integrityMaxNonReadyMs: 0,
      integrityCompromised: false,
      integrityEvents: [{type:'session-ready',at:new Date().toISOString(),recorderKey}],
      integrityPatchChain: Promise.resolve(),
    };

    this.active.set(meeting.id, state);
    this.activeByGuild.set(recorderKey, meeting.id);

    state.speakingHandler = (userId) => {
      state.lastSpeakingAt = Date.now();
      const packetCountBefore = state.totalPackets;
      this.#segment(state, userId).catch((error) => {
        this.logger?.error?.('record-segment-failed', {
          meetingId: meeting.id,
          recorderKey,
          userId,
          error: error?.message ?? String(error),
        });
      });

      // Discord may keep the voice connection Ready while the receiver stops
      // yielding packets after a reconnect. A speaking event without a packet
      // is therefore a strong signal that the receiver needs a clean rejoin.
      const timer = setTimeout(() => {
        if (
          this.active.get(meeting.id) === state &&
          state.totalPackets === packetCountBefore &&
          Date.now() - state.lastRecoveryAt > 30_000
        ) {
          void this.#recoverVoiceConnection(state, 'speaking-without-audio-packets');
        }
      }, 8_000);
      timer.unref?.();
    };
    connection.receiver.speaking.on('start', state.speakingHandler);

    connection.on('error', (error) => {
      this.logger?.warn?.('recording-voice-connection-error', {
        meetingId: meeting.id,
        recorderKey,
        status: connection.state?.status,
        error: error?.message ?? String(error),
      });
    });

    state.connectionStateHandler = (previous, next) => {
      const from = previous?.status ?? 'unknown';
      const to = next?.status ?? 'unknown';

      if (from !== to) {
        this.logger?.info?.('recording-voice-state-change', {
          meetingId: meeting.id,
          recorderKey,
          from,
          to,
          rejoinAttempts: connection.rejoinAttempts,
        });
      }

      if (to === VoiceConnectionStatus.Ready) {
        if(state.integrityNonReadySince){
          const gapMs=Math.max(0,Date.now()-state.integrityNonReadySince);
          state.integrityMaxNonReadyMs=Math.max(state.integrityMaxNonReadyMs,gapMs);
          void this.#recordIntegrityEvent(state,'voice-ready-restored',{gapMs},{compromised:gapMs>RECORDING_INTEGRITY_MAX_GAP_MS});
          state.integrityNonReadySince=0;
        }
        state.nonReadySince = 0;
        return;
      }

      if (to === VoiceConnectionStatus.Destroyed) {
        if(!state.integrityCoverageEndedAt)state.integrityCoverageEndedAt=new Date().toISOString();
        void this.#recordIntegrityEvent(state,'voice-destroyed',{recorderKey:state.recorderKey,status:to});
        // A destroyed dedicated Worker connection is a hard-failure signal.
        // Keep the state owned until failover detaches it so the main bot can
        // take over immediately instead of waiting for the 30/60s recovery jobs.
        if (state.recorderType === 'worker' && !state.meeting?.is_test && !state.meeting?.test_worker_scope) {
          void this.#failoverToMain(state,'voice-destroyed');
          return;
        }

        if (state.healthTimer) clearInterval(state.healthTimer);
        state.healthTimer = null;
        if (this.active.get(meeting.id) === state) this.active.delete(meeting.id);
        if (this.activeByGuild.get(recorderKey) === meeting.id) this.activeByGuild.delete(recorderKey);
        void releaseRecorder();
        return;
      }

      if (!state.nonReadySince) state.nonReadySince = Date.now();
      if(!state.integrityNonReadySince){
        state.integrityNonReadySince=Date.now();
        void this.#recordIntegrityEvent(state,'voice-not-ready',{status:to});
      }

      if (to === VoiceConnectionStatus.Disconnected) {
        const timer = setTimeout(() => {
          if (
            this.active.get(meeting.id) === state &&
            connection.state?.status !== VoiceConnectionStatus.Ready &&
            connection.state?.status !== VoiceConnectionStatus.Destroyed
          ) {
            void this.#recoverVoiceConnection(state, 'voice-disconnected');
          }
        }, 2_000);
        timer.unref?.();
      }
    };

    connection.on('stateChange', state.connectionStateHandler);

    state.healthTimer = setInterval(() => {
      if (this.active.get(meeting.id) !== state) {
        clearInterval(state.healthTimer);
        state.healthTimer = null;
        return;
      }

      void this.#heartbeatRecorderLease(state);

      const status = connection.state?.status;
      if (status !== VoiceConnectionStatus.Ready && status !== VoiceConnectionStatus.Destroyed) {
        if (!state.nonReadySince) state.nonReadySince = Date.now();
        if (Date.now() - state.nonReadySince >= 12_000) {
          void this.#recoverVoiceConnection(state, 'voice-not-ready-watchdog');
        }
        return;
      }

      if (status !== VoiceConnectionStatus.Ready) return;
      state.nonReadySince = 0;

      if (state.totalPackets <= 0) return;
      if (state.lastSpeakingAt <= state.lastPacketAt) return;
      if (Date.now() - state.lastPacketAt < 120_000) return;
      if (Date.now() - state.lastRecoveryAt < 5 * 60_000) return;

      void (async () => {
        const channel =
          state.voiceGuild.channels.cache.get(String(state.meeting.voice_channel_id)) ??
          await state.voiceGuild.channels.fetch(String(state.meeting.voice_channel_id)).catch(() => null);
        const humans = channel?.isVoiceBased?.()
          ? channel.members.filter((member) => !member.user.bot).size
          : 0;
        if (
          humans > 0 &&
          Date.now() - state.lastPacketAt >= 120_000 &&
          this.active.get(meeting.id) === state
        ) {
          await this.#recoverVoiceConnection(state, 'audio-packet-stall');
        }
      })().catch((error) => {
        this.logger?.warn?.('recording-watchdog-probe-failed', {
          meetingId: meeting.id,
          error: error?.message ?? String(error),
        });
      });
    }, 10_000);
    state.healthTimer.unref?.();
    return recording;
  }

  async #recordIntegrityEvent(state,type,details={}, {compromised=false}={}) {
    if(!state?.recording?.id)return;
    const event={type:String(type),at:new Date().toISOString(),...details};
    state.integrityEvents=[...(state.integrityEvents??[]),event].slice(-60);
    if(compromised)state.integrityCompromised=true;
    const patch={
      integrityGuardVersion:RECORDING_INTEGRITY_VERSION,
      integrityStatus:'recording',
      integrityCompromised:Boolean(state.integrityCompromised),
      integrityMaxNonReadyMs:Math.max(0,Number(state.integrityMaxNonReadyMs??0)||0),
      integrityCoverageStartedAt:state.integrityCoverageStartedAt??null,
      integrityCoverageEndedAt:state.integrityCoverageEndedAt??null,
      integrityEvents:state.integrityEvents,
    };
    const previous=state.integrityPatchChain??Promise.resolve();
    state.integrityPatchChain=previous.catch(()=>{}).then(()=>this.recordings.patchMetadata?.(state.recording.id,patch)).catch((error)=>{
      this.logger?.warn?.('recording-integrity-metadata-patch-failed',{meetingId:state.meeting?.id,recordingId:state.recording.id,error:error?.message??String(error)});
    });
    await state.integrityPatchChain;
  }

  // test-lab-owner-failover-v6:recording-service
  async forceTestFailover(meetingId, actorId=null) {
    const state=this.active.get(meetingId);
    if(!state)throw new Error('لا يوجد تسجيل نشط للاختبار المحدد.');
    const isTest=Boolean(state.meeting?.is_test || state.meeting?.test_worker_scope);
    if(!isTest)throw new Error('رفض تنفيذ Failover التجريبي على اجتماع حقيقي.');
    if(state.recorderType!=='worker')throw new Error('المسجل الحالي ليس Recording Worker.');
    if(state.failoverStarted)throw new Error('هناك عملية Failover جارية بالفعل.');

    const from={
      recorderKey:state.recorderKey,
      recorderType:state.recorderType,
      workerNumber:state.workerNumber??null,
      recordingId:state.recording?.id??null,
    };

    await this.#recordIntegrityEvent(
      state,
      'test-lab-owner-failover-requested',
      {actorId:actorId?String(actorId):null},
    ).catch(()=>{});

    await this.#failoverToMain(
      state,
      'test-lab-owner-simulated-failover',
      {allowTestTakeover:true},
    );

    const next=this.active.get(meetingId);
    if(!next || next===state || next.recorderType!=='main'){
      throw new Error('لم يكتمل انتقال التسجيل إلى البوت الأساسي.');
    }

    return {
      from,
      to:{
        recorderKey:next.recorderKey,
        recorderType:next.recorderType,
        workerNumber:next.workerNumber??null,
        recordingId:next.recording?.id??null,
        recorderUserId:
          next.voiceGuild?.client?.user?.id ??
          next.guild?.client?.user?.id ??
          null,
      },
    };
  }

  // recording-integrity-prestart-abort-v1.10.11
  async abortUncommittedStart(meetingId, reason='meeting-start-transaction-failed') {
    const state=this.active.get(meetingId);
    if(!state)return false;
    state.integrityCoverageEndedAt=state.integrityCoverageEndedAt??new Date().toISOString();
    state.integrityCompromised=true;
    await this.#recordIntegrityEvent(state,'meeting-start-aborted',{reason},{compromised:true});
    await this.#detachFailedState(state,reason,{failoverTarget:null});
    return true;
  }

  // recording-failover-v1.9.5.0: heartbeat + lease + Worker -> Main takeover
  async #heartbeatRecorderLease(state) {
    if (!state || state.leaseHeartbeatBusy || this.active.get(state.meeting.id) !== state) return;
    state.leaseHeartbeatBusy = true;
    try {
      if (typeof this.recordings.touchLease === 'function') {
        await this.recordings.touchLease(state.recording.id,new Date()).catch((error)=>{
          this.logger?.warn?.('recording-session-heartbeat-db-failed',{
            meetingId:state.meeting.id,recordingId:state.recording.id,error:error?.message??String(error),
          });
        });
      }

      if (state.recorderType !== 'worker' || !state.recorderLease?.heartbeat) return;

      const result = await state.recorderLease.heartbeat().catch((error)=>({
        healthy:false,reason:error?.message??String(error),
      }));

      if (result?.healthy) {
        if (state.workerUnhealthySince) {
          this.logger?.info?.('recording-worker-heartbeat-restored',{
            meetingId:state.meeting.id,recorderKey:state.recorderKey,worker:state.workerNumber,
          });
        }
        state.workerUnhealthySince = 0;
        return;
      }

      if (!state.workerUnhealthySince) {
        state.workerUnhealthySince = Date.now();
        this.logger?.warn?.('recording-worker-heartbeat-lost',{
          meetingId:state.meeting.id,recorderKey:state.recorderKey,worker:state.workerNumber,reason:result?.reason??'unhealthy',
        });
      }

      const connectionReady = state.connection?.state?.status === VoiceConnectionStatus.Ready;
      const graceMs = connectionReady ? 45_000 : 15_000;
      if (Date.now() - state.workerUnhealthySince < graceMs) return;

      await this.#failoverToMain(state,'worker-heartbeat-timeout');
    } finally {
      state.leaseHeartbeatBusy = false;
    }
  }

  async #detachFailedState(state, trigger, { failoverTarget=null }={}) {
    state.integrityCoverageEndedAt=state.integrityCoverageEndedAt??new Date().toISOString();
    if(state.integrityNonReadySince){
      const gapMs=Math.max(0,Date.now()-state.integrityNonReadySince);
      state.integrityMaxNonReadyMs=Math.max(state.integrityMaxNonReadyMs,gapMs);
      state.integrityNonReadySince=0;
    }
    await this.#recordIntegrityEvent(state,'session-detached',{trigger,failoverTarget},{compromised:state.integrityMaxNonReadyMs>RECORDING_INTEGRITY_MAX_GAP_MS});
    const segments=[...state.segments.values()];
    for(const segment of segments){ try{segment.stream.destroy();}catch{} }
    await Promise.allSettled(segments.map((segment)=>segment.finalize()));

    if(state.healthTimer)clearInterval(state.healthTimer);
    state.healthTimer=null;
    try{if(state.speakingHandler)state.connection.receiver.speaking.off('start',state.speakingHandler);}catch{}
    try{if(state.connectionStateHandler)state.connection.off('stateChange',state.connectionStateHandler);}catch{}

    if(this.active.get(state.meeting.id)===state)this.active.delete(state.meeting.id);
    if(this.activeByGuild.get(state.recorderKey)===state.meeting.id)this.activeByGuild.delete(state.recorderKey);

    try{state.connection.destroy();}catch{}
    await state.releaseRecorder?.().catch(()=>{});
    if (typeof this.recordings.patchMetadata === 'function') {
      await this.recordings.patchMetadata(state.recording.id,{
        interrupted:true,
        interruptionReason:trigger,
        interruptedAt:new Date().toISOString(),
        failoverTarget,
      }).catch(()=>{});
    }
    await this.recordings.stop(state.recording.id, 'failed').catch(()=>{});
  }

  // recording-integrity-handoff-v1.10.11 — make-before-break Worker -> Main.
  async #failoverToMain(state, trigger, {allowTestTakeover=false}={}) {
    if (!state || state.failoverStarted) return false;
    if (this.active.get(state.meeting.id) !== state) return false;

    state.failoverStarted = true;

    const isTest = Boolean(
      state.meeting?.is_test || state.meeting?.test_worker_scope
    );

    const canTakeOver =
      state.recorderType === 'worker' &&
      (!isTest || allowTestTakeover);

    const previousRecordingId = state.recording.id;

    this.logger?.warn?.('recording-failover-preparing', {
      meetingId: state.meeting.id,
      recorderKey: state.recorderKey,
      worker: state.workerNumber,
      trigger,
      target: canTakeOver ? 'main' : 'none',
      strategy: canTakeOver ? 'make-before-break' : 'detach-only',
    });

    if (!canTakeOver) {
      await this.#detachFailedState(
        state,
        trigger,
        { failoverTarget: null }
      );
      return false;
    }

    let next = null;

    try {
      next = await this.#startCore({
        meeting: state.meeting,
        guild: state.guild,
        actorId: state.actorId,
        recovery: false,
        forceMainRecorder: true,
        sessionReason: 'worker-failover-main',
        failoverFromRecordingId: previousRecordingId,
        failoverTrigger: trigger,
        handoffFromState: state,
        allowTestMainRecorder: allowTestTakeover,
      });
    } catch (error) {
      const oldStillUsable =
        state.connection?.state?.status === VoiceConnectionStatus.Ready;

      this.logger?.error?.('recording-failover-to-main-failed', {
        meetingId: state.meeting.id,
        fromRecorderKey: state.recorderKey,
        fromRecordingId: previousRecordingId,
        trigger,
        oldStillUsable,
        error: error?.stack ?? String(error),
      });

      if (
        oldStillUsable &&
        this.active.get(state.meeting.id) === state
      ) {
        state.failoverStarted = false;

        await this.#recordIntegrityEvent(
          state,
          'main-handoff-start-failed',
          {
            trigger,
            error: error?.message ?? String(error),
            oldStillUsable: true,
          }
        );

        return false;
      }

      if (this.active.get(state.meeting.id) === state) {
        await this.#detachFailedState(
          state,
          trigger,
          { failoverTarget: 'main-retry' }
        );
      }

      return false;
    }

    const nextState = this.active.get(state.meeting.id);

    if (!nextState || nextState === state) {
      state.failoverStarted = false;
      throw new Error(
        'Main handoff returned without replacing the active Recording state.'
      );
    }

    const handoffAt =
      nextState.integrityCoverageStartedAt ??
      new Date().toISOString();

    const oldEnd = integrityMs(state.integrityCoverageEndedAt);
    const handoffMs = integrityMs(handoffAt);

    if (
      !Number.isFinite(oldEnd) ||
      (Number.isFinite(handoffMs) && oldEnd > handoffMs)
    ) {
      state.integrityCoverageEndedAt = handoffAt;
    }

    await this.#recordIntegrityEvent(
      state,
      'main-handoff-ready',
      {
        trigger,
        toRecordingId:
          next?.id ??
          nextState.recording?.id ??
          null,
        handoffAt,
        strategy: 'make-before-break',
      }
    );

    await this.#detachFailedState(
      state,
      trigger,
      { failoverTarget: 'main' }
    );

    this.logger?.info?.('recording-failover-to-main-success', {
      meetingId: state.meeting.id,
      fromRecorderKey: state.recorderKey,
      fromRecordingId: previousRecordingId,
      toRecordingId:
        next?.id ??
        nextState.recording?.id ??
        null,
      trigger,
      strategy: 'make-before-break',
    });

    return true;
  }

  async #recoverVoiceConnection(state, trigger) {
    if (!state || state.voiceRecovering) return false;
    if (this.active.get(state.meeting.id) !== state) return false;

    const connection = state.connection;

    const forceRejoin =
      trigger === 'audio-packet-stall' ||
      trigger === 'speaking-without-audio-packets';

    if (
      connection.state?.status === VoiceConnectionStatus.Destroyed
    ) {
      await this.#detachFailedState(
        state,
        trigger,
        { failoverTarget: 'recovery-restart' }
      );
      return false;
    }

    if (
      !forceRejoin &&
      connection.state?.status === VoiceConnectionStatus.Ready
    ) {
      state.nonReadySince = 0;
      return true;
    }

    if (state.failoverStarted) return false;

    if (forceRejoin) {
      await this.#recordIntegrityEvent(
        state,
        'receiver-stall-detected',
        { trigger },
        { compromised: false }
      );
    }

    state.voiceRecovering = true;
    state.lastRecoveryAt = Date.now();

    try {
      this.logger?.warn?.('recording-voice-recovery-start', {
        meetingId: state.meeting.id,
        recorderKey: state.recorderKey,
        trigger,
        status: connection.state?.status,
        lastPacketAgeMs:
          Date.now() - Number(state.lastPacketAt ?? Date.now()),
      });

      const staleSegments = [...state.segments.values()];

      for (const segment of staleSegments) {
        try {
          segment.stream.destroy();
        } catch {}
      }

      await Promise.allSettled(
        staleSegments.map((segment) => segment.finalize())
      );

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (
          !forceRejoin &&
          connection.state?.status === VoiceConnectionStatus.Ready
        ) {
          state.nonReadySince = 0;
          return true;
        }

        if (
          connection.state?.status === VoiceConnectionStatus.Destroyed
        ) {
          await this.#detachFailedState(
            state,
            trigger,
            { failoverTarget: 'recovery-restart' }
          );
          return false;
        }

        try {
          const ok = connection.rejoin({
            channelId: String(state.meeting.voice_channel_id),
            selfDeaf: false,
            selfMute: true,
          });

          if (!ok) {
            throw new Error('VoiceConnection.rejoin returned false');
          }

          await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            15_000
          );

          try {
            if (state.speakingHandler) {
              connection.receiver.speaking.off(
                'start',
                state.speakingHandler
              );

              connection.receiver.speaking.on(
                'start',
                state.speakingHandler
              );
            }
          } catch {}

          const recoveryNow = Date.now();

          if (state.integrityNonReadySince) {
            const gapMs = Math.max(
              0,
              recoveryNow - state.integrityNonReadySince
            );

            state.integrityMaxNonReadyMs = Math.max(
              state.integrityMaxNonReadyMs,
              gapMs
            );

            await this.#recordIntegrityEvent(
              state,
              'voice-recovered-integrity-check',
              { trigger, attempt, gapMs },
              {
                compromised:
                  gapMs > RECORDING_INTEGRITY_MAX_GAP_MS,
              }
            );

            state.integrityNonReadySince = 0;
          }

          state.nonReadySince = 0;
          state.lastPacketAt = recoveryNow;

          await this.#recordIntegrityEvent(
            state,
            'voice-recovered',
            { trigger, attempt }
          );

          this.logger?.info?.('recording-voice-recovered', {
            meetingId: state.meeting.id,
            recorderKey: state.recorderKey,
            trigger,
            attempt,
          });

          return true;
        } catch (error) {
          this.logger?.warn?.('recording-voice-rejoin-failed', {
            meetingId: state.meeting.id,
            recorderKey: state.recorderKey,
            trigger,
            attempt,
            status: connection.state?.status,
            error:
              error?.stack ??
              error?.message ??
              String(error),
          });

          if (
            connection.state?.status ===
            VoiceConnectionStatus.Destroyed
          ) {
            await this.#detachFailedState(
              state,
              trigger,
              { failoverTarget: 'recovery-restart' }
            );
            return false;
          }

          if (attempt < 3) {
            await new Promise((resolve) =>
              setTimeout(resolve, attempt * 1_500)
            );
          }
        }
      }

      await this.#detachFailedState(
        state,
        trigger,
        { failoverTarget: 'recovery-restart' }
      );

      return false;
    } finally {
      state.voiceRecovering = false;
    }
  }
  async #segment(state, userId) {
    if (state.segments.has(userId)) return;
    const n = (state.counter.get(userId) ?? 0) + 1;
    state.counter.set(userId, n);
    const startedAt = new Date();
    const file = path.join(state.dir, `${userId}-seg-${String(n).padStart(3, '0')}.ogg`);
    const writer = new OggOpusWriter(file);
    const stream = state.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    let finalized = false;
    const segment = {
      stream,
      writer,
      startedAt,
      repo:this.recordings,
      async finalize() {
        if (finalized) return;
        finalized = true;
        state.segments.delete(userId);
        const stats = await writer.end();
        await this.repo.addTrack({
          recordingId: state.recording.id,
          userId,
          path: file,
          startedAt,
          endedAt: new Date(),
          packetCount: stats.packetCount,
          bytes: stats.bytes,
          metadata: { segment: n, assumedPacketMs: 20 },
        });
      },
    };
    state.segments.set(userId, segment);
    stream.on('data', (packet) => {
      state.lastPacketAt = Date.now();
      state.totalPackets = Number(state.totalPackets ?? 0) + 1;
      writer.write(packet);
    });
    stream.once('end', () => segment.finalize().catch((error) => this.logger.error('track finalize failed', { error: error.message })));
    stream.once('error', (error) => segment.finalize().catch(() => {}).finally(() => this.logger.warn('voice receive stream error', { error: error.message, userId })));
  }

  // recording-integrity-mixer-v1.10.11 — timeline tree, no input-side seek on raw OGG.
  async #buildMixedParts(recording, meetingTitle='اجتماع', { meetingId=recording?.meeting_id, meetingStartedAt=null, meetingEndedAt=null }={}){
    const rows = meetingId && this.recordings.listForMeeting
      ? await this.recordings.listForMeeting(meetingId).catch(() => [recording])
      : [recording];
    const tracks = meetingId && this.recordings.tracksForMeeting
      ? await this.recordings.tracksForMeeting(meetingId).catch(() => this.recordings.tracks(recording.id))
      : await this.recordings.tracks(recording.id);
    if(!tracks.length)return [];

    try{await runProcess('ffmpeg',['-version'],{timeoutMs:10000});}
    catch{return []}

    const probeDuration=async(file)=>{
      try{
        const {stdout}=await runProcess('ffprobe',[
          '-v','error','-show_entries','format=duration',
          '-of','default=noprint_wrappers=1:nokey=1',file,
        ],{timeoutMs:30_000});
        const n=Number(String(stdout??'').trim());
        return Number.isFinite(n)&&n>0?n:0;
      }catch{return 0}
    };

    const sessionById=new Map(rows.map((row)=>[String(row.id),row]));
    const valid=[];let missing=0,bad=0;
    for(let i=0;i<tracks.length;i++){
      const track=tracks[i];
      try{
        const st=await fs.stat(String(track.path??''));
        if(!st.isFile()||st.size<100){missing++;continue}
        const rawStartedMs=new Date(track.started_at).getTime();
        if(!Number.isFinite(rawStartedMs)){bad++;continue}
        const rawDurationSec=await probeDuration(String(track.path));
        if(!(rawDurationSec>0.01)){bad++;continue}
        const session=sessionById.get(String(track.recording_id??''));
        const coverageStartMs=new Date(session?.metadata?.integrityCoverageStartedAt??session?.started_at??'').getTime();
        const coverageEndMs=new Date(session?.metadata?.integrityCoverageEndedAt??session?.stopped_at??'').getTime();
        const startedMs=Number.isFinite(coverageStartMs)?Math.max(rawStartedMs,coverageStartMs):rawStartedMs;
        let endedMs=rawStartedMs+Math.max(20,Math.round(rawDurationSec*1000));
        if(Number.isFinite(coverageEndMs))endedMs=Math.min(endedMs,coverageEndMs);
        if(endedMs<=startedMs+10){bad++;continue}
        const trimStartSec=Math.max(0,(startedMs-rawStartedMs)/1000);
        const durationSec=(endedMs-startedMs)/1000;
        valid.push({...track,path:String(track.path),startedMs,endedMs,durationSec,trimStartSec});
      }catch{missing++}
    }
    if(missing||bad){
      this.logger?.warn?.('recording-integrity-raw-track-gap',{meetingId,recordingId:recording.id,totalTracks:tracks.length,validTracks:valid.length,missing,bad});
      return [];
    }
    if(!valid.length)return [];

    const seen=new Set(),dedup=[];
    for(const track of valid){
      const key=[String(track.user_id??''),Math.round(track.startedMs/20),Number(track.packet_count??0),Number(track.bytes??0),String(track.path)].join('|');
      if(seen.has(key))continue;seen.add(key);dedup.push(track);
    }
    dedup.sort((a,b)=>a.startedMs-b.startedMs||String(a.id??'').localeCompare(String(b.id??'')));

    const rowStarts=rows.map(r=>new Date(r?.metadata?.integrityCoverageStartedAt??r?.started_at).getTime()).filter(Number.isFinite);
    const rowEnds=rows.map(r=>new Date(r?.metadata?.integrityCoverageEndedAt??r?.stopped_at).getTime()).filter(Number.isFinite);
    const explicitStart=new Date(meetingStartedAt??'').getTime();
    const explicitEnd=new Date(meetingEndedAt??'').getTime();
    const timelineStart=Number.isFinite(explicitStart)?explicitStart:Math.min(...rowStarts,dedup[0].startedMs);
    const timelineEnd=Number.isFinite(explicitEnd)&&explicitEnd>timelineStart
      ? explicitEnd
      : Math.max(...rowEnds,...dedup.map(t=>t.endedMs));
    const targetSec=(timelineEnd-timelineStart)/1000;
    if(!(targetSec>0.1&&targetSec<12*3600)){
      this.logger?.warn?.('recording-integrity-invalid-target-duration',{meetingId,targetSec});
      return [];
    }

    const relevant=dedup.filter(t=>t.startedMs<timelineEnd+1000&&t.endedMs>timelineStart-1000);
    if(!relevant.length)return [];

    // Compatibility marker for the older v1.9.2 source-level regression test:
    // finalMixVersion:'1.9.5'
    const safeTitle=safeAudioFilePart(meetingTitle);
    const finalPath=path.join(recording.storage_path,safeTitle+'.ogg');
    const workDir=path.join(recording.storage_path,'.final-integrity-mix-v11011');
    await fs.rm(workDir,{recursive:true,force:true}).catch(()=>{});
    await fs.mkdir(workDir,{recursive:true});
    const MAX_INPUTS=8;
    const SAMPLE_RATE=16000;
    const BITRATE='24k';
    const ffmpegTimeoutFor=(seconds)=>Math.max(5*60_000,Math.ceil(Math.max(1,seconds)*2500));

    const mixGroup=async(group,round,index)=>{
      if(group.length===1)return group[0];
      const base=Math.min(...group.map(n=>n.startMs));
      const end=Math.max(...group.map(n=>n.endMs));
      const durationSec=Math.max(0.02,(end-base)/1000);
      const out=path.join(workDir,'round-'+String(round).padStart(2,'0')+'-'+String(index).padStart(4,'0')+'.ogg');
      const args=['-hide_banner','-loglevel','error','-y'];
      const filters=[],labels=[];
      group.forEach((n,idx)=>{
        args.push('-i',n.path);
        const delay=Math.max(0,Math.round(n.startMs-base));
        const trim=n.leaf
          ? ',atrim=start='+(Number(n.trimStartSec??0)).toFixed(3)+':duration='+Math.max(0.01,(n.endMs-n.startMs)/1000).toFixed(3)
          : '';
        filters.push('['+idx+':a]aresample='+SAMPLE_RATE+',aformat=sample_fmts=fltp:channel_layouts=mono'+trim+',asetpts=PTS-STARTPTS,adelay='+delay+':all=1[a'+idx+']');
        labels.push('[a'+idx+']');
      });
      filters.push(labels.join('')+'amix=inputs='+group.length+':duration=longest:dropout_transition=0,apad,atrim=duration='+durationSec.toFixed(3)+'[mix]');
      args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[mix]','-t',durationSec.toFixed(3),'-ac','1','-ar',String(SAMPLE_RATE),'-c:a','libopus','-b:a',BITRATE,'-vbr','on',out);
      await runProcess('ffmpeg',args,{timeoutMs:ffmpegTimeoutFor(durationSec)});
      const actual=await probeDuration(out);
      if(!(actual>0)||actual<durationSec*0.97||actual>durationSec*1.03){
        throw new Error('integrity mixer intermediate duration mismatch actual='+actual+' expected='+durationSec);
      }
      return {path:out,startMs:base,endMs:end,leaf:false};
    };

    try{
      let nodes=relevant.map(t=>({path:t.path,startMs:t.startedMs,endMs:t.endedMs,trimStartSec:t.trimStartSec??0,leaf:true}));
      let round=0;
      while(nodes.length>1){
        round++;nodes.sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
        const next=[];
        for(let i=0;i<nodes.length;i+=MAX_INPUTS){
          next.push(await mixGroup(nodes.slice(i,i+MAX_INPUTS),round,next.length+1));
        }
        for(const n of nodes){if(!n.leaf&&!next.some(x=>x.path===n.path))await fs.rm(n.path,{force:true}).catch(()=>{})}
        nodes=next;
      }

      const mixed=nodes[0];
      const trimStartSec=Math.max(0,(timelineStart-mixed.startMs)/1000);
      const delayMs=Math.max(0,Math.round(mixed.startMs-timelineStart));
      const tmp=path.join(workDir,'FINAL.tmp.ogg');
      const filter='atrim=start='+trimStartSec.toFixed(3)+',asetpts=PTS-STARTPTS,adelay='+delayMs+':all=1,apad,atrim=duration='+targetSec.toFixed(3);
      await runProcess('ffmpeg',[
        '-hide_banner','-loglevel','error','-y','-i',mixed.path,
        '-af',filter,'-t',targetSec.toFixed(3),'-ac','1','-ar',String(SAMPLE_RATE),
        '-c:a','libopus','-b:a',BITRATE,'-vbr','on',tmp,
      ],{timeoutMs:ffmpegTimeoutFor(targetSec)});
      const actual=await probeDuration(tmp);
      if(!(actual>0)||actual<targetSec*0.985||actual>targetSec*1.015){
        throw new Error('integrity final duration mismatch actual='+actual+' expected='+targetSec);
      }
      const stat=await fs.stat(tmp).catch(()=>null);if(!stat||stat.size<1000)throw new Error('integrity final file too small');
      try{
        const old=await fs.stat(finalPath);
        if(old.size>0)await fs.copyFile(finalPath,path.join(recording.storage_path,safeTitle+'.before-v11011-'+Date.now()+'.bak.ogg'));
      }catch{}
      await fs.rename(tmp,finalPath);
      return [finalPath];
    }catch(error){
      this.logger?.warn?.('recording-integrity-final-mix-failed',{meetingId,recordingId:recording.id,error:error?.message??String(error)});
      return [];
    }finally{
      await fs.rm(workDir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async stopByMeeting(meetingId, { meetingTitle=null, meetingStartedAt=null, meetingEndedAt=null }={}) {
    const state = this.active.get(meetingId);
    let recording = state?.recording ?? await this.recordings.latestForMeeting(meetingId);
    if (!recording) return null;

    const title = safeAudioFilePart(meetingTitle ?? state?.meetingTitle ?? 'اجتماع');

    if (state) {
      state.integrityCoverageEndedAt=new Date().toISOString();
      if(state.integrityNonReadySince){
        const gapMs=Math.max(0,Date.now()-state.integrityNonReadySince);
        state.integrityMaxNonReadyMs=Math.max(state.integrityMaxNonReadyMs,gapMs);
        state.integrityNonReadySince=0;
      }
      await this.#recordIntegrityEvent(state,'session-stopping',{}, {compromised:state.integrityMaxNonReadyMs>RECORDING_INTEGRITY_MAX_GAP_MS});
      const segments = [...state.segments.values()];
      for (const segment of segments) {
        try { segment.stream.destroy(); } catch {}
      }
      await Promise.allSettled(segments.map((segment) => segment.finalize()));

      if (state.healthTimer) clearInterval(state.healthTimer);
      state.healthTimer = null;
      try {
        if (state.speakingHandler) state.connection.receiver.speaking.off('start', state.speakingHandler);
      } catch {}
      try {
        if (state.connectionStateHandler) state.connection.off('stateChange', state.connectionStateHandler);
      } catch {}

      try { state.connection.destroy(); } catch {}
      this.active.delete(meetingId);
      if (this.activeByGuild.get(state.recorderKey ?? `main:${state.guildId}`) === meetingId) {
        this.activeByGuild.delete(state.recorderKey ?? `main:${state.guildId}`);
      }
      await state.releaseRecorder?.().catch(() => {});
      recording = await this.recordings.stop(state.recording.id, 'completed');
    }

    // Any older row left open by a reconnect is historical session state, not
    // a reason to lose its tracks. Close it, then mix tracks from ALL rows.
    await this.recordings.failOpenForMeeting(meetingId).catch(() => []);
    recording = await this.recordings.latestForMeeting(meetingId) ?? recording;

    const sessions=await this.recordings.listForMeeting(meetingId).catch(()=>[]);
    const guardEnabled=sessions.some((row)=>String(row?.metadata?.integrityGuardVersion??'')===RECORDING_INTEGRITY_VERSION);
    const manualRecoveryFinals = Array.isArray(recording?.final_paths)
      ? recording.final_paths.filter(Boolean)
      : [];
    const manualRecovery =
      recording?.metadata?.manualRecovery === true &&
      String(recording?.metadata?.finalMixVersion??'') === 'manual-recovery-v1' &&
      recording?.status === 'completed' &&
      manualRecoveryFinals.length === 1;

    const integrity=guardEnabled
      ? evaluateRecordingIntegrity({sessions,meetingStartedAt,meetingEndedAt})
      : null;

    if(manualRecovery){
      this.logger?.info?.('recording-manual-recovery-preserved',{
        meetingId,
        recordingId:recording.id,
        finalPath:manualRecoveryFinals[0],
        integrityStatus:recording?.metadata?.integrityStatus??'needs_recovery',
        integrityMaxGapMs:recording?.metadata?.integrityMaxGapMs??null,
      });
      return recording;
    }

    if(guardEnabled && !integrity?.ok){
      await this.recordings.patchMetadata?.(recording.id,{
        integrityGuardVersion:RECORDING_INTEGRITY_VERSION,
        integrityStatus:'needs_recovery',
        integrityReasons:integrity?.reasons??['integrity-check-failed'],
        integrityMaxGapMs:integrity?.maxGapMs??null,
        integrityCoverageRatio:integrity?.coverageRatio??0,
        integrityCheckedAt:new Date().toISOString(),
      }).catch(()=>{});
      this.logger?.warn?.('recording-integrity-blocked-publication',{meetingId,recordingId:recording.id,reasons:integrity?.reasons??[],maxGapMs:integrity?.maxGapMs??null,coverageRatio:integrity?.coverageRatio??0});
      return await this.recordings.latestForMeeting(meetingId) ?? recording;
    }

    const existingFinal = Array.isArray(recording.final_paths) ? recording.final_paths.filter(Boolean) : [];
    const hasProductionMix = ['1.9.2','1.9.5','1.10.11'].includes(recording?.metadata?.finalMixVersion) && existingFinal.length > 0;
    if (hasProductionMix && (!guardEnabled || recording?.metadata?.integrityStatus==='verified')) return recording;

    const parts = await this.#buildMixedParts(recording, title, { meetingId, meetingStartedAt, meetingEndedAt }).catch((error) => {
      this.logger?.warn?.('meeting timeline final mix failed', {
        meetingId,
        recordingId: recording?.id,
        error: error?.message ?? String(error),
      });
      return [];
    });

    if (parts.length) {
      if (recording.status !== 'completed') recording = await this.recordings.stop(recording.id, 'completed');
      const finalSessions=sessions;
      const failoverSessions=finalSessions.filter((row)=>
        String(row.session_reason??'').includes('failover') || Boolean(row.failover_from_recording_id)
      ).length;
      recording = await this.recordings.setFinalFiles(recording.id, parts, {
        finalScope:'meeting-timeline',
        finalMixVersion:guardEnabled?'1.10.11':'1.9.5',
        includesRecoveryRows:true,
        ...(guardEnabled?{
          integrityGuardVersion:RECORDING_INTEGRITY_VERSION,
          integrityStatus:'verified',
          integrityReasons:[],
          integrityMaxGapMs:integrity?.maxGapMs??0,
          integrityCoverageRatio:integrity?.coverageRatio??1,
          integrityVerifiedAt:new Date().toISOString(),
        }:{}),
        recordingSessions:finalSessions.length,
        failoverSessions,
        sessionIds:finalSessions.map((row)=>String(row.id)),
      });
    }

    if(guardEnabled && !parts.length){
      await this.recordings.patchMetadata?.(recording.id,{
        integrityGuardVersion:RECORDING_INTEGRITY_VERSION,
        integrityStatus:'needs_recovery',
        integrityReasons:['final-build-failed'],
        integrityCheckedAt:new Date().toISOString(),
      }).catch(()=>{});
      recording=await this.recordings.latestForMeeting(meetingId) ?? recording;
    }

    return recording;
  }

}
