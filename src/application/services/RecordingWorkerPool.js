import { Client, GatewayIntentBits } from 'discord.js';

// recording-failover-v1.9.5.0:lease
const WORKER_LEASE_TTL_MS = 90_000;

function splitTokens(value) {
  return String(value ?? '')
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeScope(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || ['*', 'any', 'all'].includes(v)) return 'any';
  if (['media', 'الإعلام', 'اعلام', 'الإعلامي', 'اعلامي'].includes(v)) return 'media';
  if (['hr', 'human-resources', 'human_resources', 'الموارد البشرية', 'موارد بشرية'].includes(v)) return 'hr';
  if (['governance', 'الإدارة', 'الادارة', 'الحوكمة'].includes(v)) return 'governance';
  if (['membership', 'العضوية', 'التنظيم'].includes(v)) return 'membership';
  if (['projects', 'المشاريع', 'الخدمات'].includes(v)) return 'projects';
  if (['tech', 'التقنية', 'البحث', 'البيانات'].includes(v)) return 'tech';
  if (['general', 'public', 'general-meetings', 'general_meetings', 'الاجتماعات العامة', 'اجتماعات عامة', 'الاجتماع العام', 'اجتماع عام'].includes(v)) return 'general';
  // executive-worker-v1.9.4.0:normalize
  if ([
    'executive',
    'exec',
    'الفريق التنفيذي',
    'التنفيذي',
    'تنفيذي'
  ].includes(v)) return 'executive';
  return v;
}

function classifyMeetingTeam(meeting) {
  const explicit = normalizeScope(
    meeting?.team_key ??
    meeting?.team_code ??
    meeting?.team_slug ??
    ''
  );
  if (explicit !== 'any') return explicit;

  // The dedicated public-meetings voice channel overrides team labels.
  // General meetings still need a backing team_id in the current schema, so
  // channel identity is the authoritative routing signal for Worker 6.
  const voiceChannelId = String(
    meeting?.voice_channel_id ??
    meeting?.voiceChannelId ??
    ''
  ).trim();
  const generalVoiceChannelId = String(process.env.GENERAL_VOICE_CHANNEL_ID ?? '').trim();
  if (generalVoiceChannelId && voiceChannelId === generalVoiceChannelId) return 'general';

  const text = String(
    meeting?.team_name ??
    meeting?.teamName ??
    ''
  ).trim().toLowerCase();

  if (text.includes('الإعلام') || text.includes('اعلام') ||
      text.includes('العلاقات') || text.includes('الشراكات')) return 'media';
  if (text.includes('الموارد البشرية') || text.includes('موارد بشرية')) return 'hr';
  if (text.includes('الحوكمة') || text.includes('الإدارة') || text.includes('الادارة')) return 'governance';
  if (text.includes('العضوية') || text.includes('التنظيم الداخلي')) return 'membership';
  if (text.includes('المشاريع') || text.includes('الخدمات المجتمعية')) return 'projects';
  if (text.includes('التقنية') || text.includes('البحث') || text.includes('البيانات')) return 'tech';

  if (text.includes('الاجتماعات العامة') || text.includes('اجتماعات عامة') || text.includes('الاجتماع العام') || text.includes('اجتماع عام') || text.includes('general meeting')) return 'general';
  // executive-worker-v1.9.4.0:classify
  if (
    text.includes('الفريق التنفيذي') ||
    text.includes('التنفيذي') ||
    text.includes('تنفيذي')
  ) return 'executive';

  return 'unknown';
}

function configuredWorkers() {
  const result = [];
  const seenTokens = new Set();

  const numbered = Object.keys(process.env)
    .map((key) => {
      const m = key.match(/^RECORDING_WORKER_TOKEN_(\d+)$/);
      return m ? { key, number: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);

  for (const item of numbered) {
    const token = String(process.env[item.key] ?? '').trim();
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);
    result.push({
      number: item.number,
      token,
      teamScope: normalizeScope(process.env[`RECORDING_WORKER_TEAM_${item.number}`]),
    });
  }

  // Keep compatibility with RECORDING_WORKER_TOKENS. These stay general-purpose.
  let next = numbered.length ? Math.max(...numbered.map((x) => x.number)) + 1 : 1;
  for (const token of splitTokens(process.env.RECORDING_WORKER_TOKENS)) {
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    result.push({ number: next++, token, teamScope: 'any' });
  }

  return result;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    }),
  ]);
}

export class RecordingWorkerPool {
  constructor({ logger }) {
    this.logger = logger;
    this.workers = [];
    this.busy = new Map();
    this.warned = new Set();
    this.initializing = this.#initialize();
  }

  async #initialize() {
    const configured = configuredWorkers();

    if (!configured.length) {
      this.logger?.info?.('recording-worker-pool-disabled', { configured: 0 });
      return;
    }

    const results = await Promise.all(
      configured.map((config) => this.#login(config))
    );

    this.workers = results.filter(Boolean);

    this.logger?.info?.('recording-worker-pool-ready', {
      configured: configured.length,
      ready: this.workers.length,
      scopes: this.workers.map((w) => ({
        worker: w.number,
        teamScope: w.teamScope,
      })),
    });
  }

  async #login({ token, number, teamScope }) {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
      presence: {
        status: 'online',
        activities: [{
          name:
            teamScope === 'media'
              ? 'تسجيل اجتماعات الفريق الإعلامي'
              : teamScope === 'hr'
                ? 'تسجيل اجتماعات الموارد البشرية'
                : 'تسجيل الاجتماعات'
        }],
      },
    });

    try {
      await withTimeout(
        client.login(token),
        20_000,
        `Recording Worker ${number} تجاوز مهلة الاتصال بـ Discord.`,
      );

      this.logger?.info?.('recording-worker-online', {
        worker: number,
        userId: client.user?.id ?? null,
        tag: client.user?.tag ?? null,
        teamScope,
      });

      return { number, client, teamScope };
    } catch (error) {
      try { client.destroy(); } catch {}
      this.logger?.warn?.('recording-worker-login-failed', {
        worker: number,
        teamScope,
        error: error?.message ?? String(error),
      });
      return null;
    }
  }

  #pruneExpiredLeases() {
    const now = Date.now();
    for (const [key, lease] of this.busy.entries()) {
      if (!lease || Number(lease.expiresAt ?? 0) > now) continue;
      this.busy.delete(key);
      this.logger?.warn?.('recording-worker-lease-expired', {
        recorderKey: key,
        meetingId: lease?.meetingId ?? null,
        worker: lease?.workerNumber ?? null,
      });
    }
  }

  async acquire({ guild, meetingId, meeting = null }) {
    await this.initializing.catch(() => {});
    this.#pruneExpiredLeases();

    // test-lab-v1.9.3.8:forced-scope
    const forcedTestScope=meeting?.test_worker_scope
      ? normalizeScope(meeting.test_worker_scope)
      : null;

    const meetingTeam=
      forcedTestScope && forcedTestScope !== 'any'
        ? forcedTestScope
        : classifyMeetingTeam(meeting);

    // Dedicated workers are eligible only for their own team.
    const candidates = this.workers.filter((worker) =>
      worker.teamScope === 'any' || worker.teamScope === meetingTeam
    );

    for (const worker of candidates) {
      const workerUserId = String(worker.client.user?.id ?? '');

      // Never allow the main bot token to be used as a worker by mistake.
      if (workerUserId && workerUserId === String(guild.client.user?.id ?? '')) {
        const warningKey = `duplicate-main:${worker.number}`;
        if (!this.warned.has(warningKey)) {
          this.warned.add(warningKey);
          this.logger?.warn?.('recording-worker-duplicates-main-bot', {
            worker: worker.number,
          });
        }
        continue;
      }

      const recorderKey = `worker:${worker.number}:${guild.id}`;
      if (this.busy.has(recorderKey)) continue;

      // recording-failover-v1.9.5.0: heartbeat-backed lease.
      // Reserve before awaits to avoid two meetings racing for the same worker.
      const leaseState = {
        meetingId,
        workerNumber: worker.number,
        teamScope: worker.teamScope,
        acquiredAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + WORKER_LEASE_TTL_MS,
      };
      this.busy.set(recorderKey, leaseState);

      try {
        const workerGuild =
          worker.client.guilds.cache.get(String(guild.id)) ??
          await worker.client.guilds.fetch(String(guild.id));

        const release = async () => {
          const current = this.busy.get(recorderKey);
          if (current?.meetingId === meetingId) this.busy.delete(recorderKey);
        };

        const heartbeat = async () => {
          const current = this.busy.get(recorderKey);
          if (current?.meetingId !== meetingId) {
            return { healthy:false, reason:'lease-lost', expiresAt:Number(current?.expiresAt ?? 0) };
          }

          const healthy = Boolean(worker.client?.isReady?.());
          if (healthy) {
            current.heartbeatAt = Date.now();
            current.expiresAt = current.heartbeatAt + WORKER_LEASE_TTL_MS;
            this.busy.set(recorderKey, current);
          }

          return {
            healthy,
            reason: healthy ? null : 'worker-client-not-ready',
            heartbeatAt: current.heartbeatAt,
            expiresAt: current.expiresAt,
          };
        };

        this.logger?.info?.('recording-worker-assigned', {
          worker: worker.number,
          meetingId,
          meetingTeam,
          teamScope: worker.teamScope,
          recorderUserId: workerUserId || null,
        });

        return {
          key: recorderKey,
          guild: workerGuild,
          recorderType: 'worker',
          recorderUserId: workerUserId || null,
          workerNumber: worker.number,
          teamScope: worker.teamScope,
          leaseTtlMs: WORKER_LEASE_TTL_MS,
          heartbeat,
          isHealthy: () => {
            const current = this.busy.get(recorderKey);
            return Boolean(
              current?.meetingId === meetingId &&
              Number(current.expiresAt ?? 0) > Date.now() &&
              worker.client?.isReady?.()
            );
          },
          release,
        };
      } catch (error) {
        if (this.busy.get(recorderKey)?.meetingId === meetingId) {
          this.busy.delete(recorderKey);
        }

        const warningKey = `guild-missing:${worker.number}:${guild.id}`;
        if (!this.warned.has(warningKey)) {
          this.warned.add(warningKey);
          this.logger?.warn?.('recording-worker-not-available-in-guild', {
            worker: worker.number,
            guildId: String(guild.id),
            teamScope: worker.teamScope,
            error: error?.message ?? String(error),
          });
        }
      }
    }

    // Important: null means RecordingService falls back to the main bot.
    if (meetingTeam === 'media') {
      this.logger?.warn?.('media-recording-worker-unavailable-fallback-main', {
        meetingId,
      });
    }

    return null;
  }

  status(guildId) {
    this.#pruneExpiredLeases();
    const guildSuffix = `:${guildId}`;
    const busyWorkers = [...this.busy.keys()]
      .filter((key) => key.endsWith(guildSuffix)).length;

    return {
      configuredReadyWorkers: this.workers.length,
      busyWorkers,
      idleWorkers: Math.max(0, this.workers.length - busyWorkers),
      scopes: this.workers.map((w) => ({
        worker: w.number,
        teamScope: w.teamScope,
      })),
    };
  }

  async shutdown() {
    for (const worker of this.workers) {
      try { worker.client.destroy(); } catch {}
    }
    this.workers = [];
    this.busy.clear();
  }
}
