export class GuildRepository {
  constructor(db) { this.db=db;this.settingsCache=new Map();this.settingsTtlMs=15_000; }
  _settingsKey(guildId){return String(guildId);}
  async ensure({ guildId, name, ownerUserId }, client = this.db) {
    await client.query(`INSERT INTO guilds(id,name,owner_user_id) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, owner_user_id=EXCLUDED.owner_user_id, updated_at=now()`, [guildId, name, ownerUserId]);
    await client.query(`INSERT INTO settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING`, [guildId]);
  }
  async upsertUser({ userId, username, displayName }, client = this.db) {await client.query(`INSERT INTO users(id,username,display_name) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username, display_name=EXCLUDED.display_name, updated_at=now()`, [userId, username, displayName]);}
  async ensureMember(guildId, userId, client = this.db) {await client.query(`INSERT INTO members(guild_id,user_id) VALUES($1,$2) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=true`, [guildId,userId]);}
  async getSettings(guildId, client = this.db) {
    if(client===this.db){const key=this._settingsKey(guildId),hit=this.settingsCache.get(key);if(hit&&hit.expiresAt>Date.now())return hit.value;}
    const { rows } = await client.query('SELECT * FROM settings WHERE guild_id=$1', [guildId]);const value=rows[0]??null;
    if(client===this.db)this.settingsCache.set(this._settingsKey(guildId),{value,expiresAt:Date.now()+this.settingsTtlMs});
    return value;
  }
  async updateSettings(guildId, patch, client = this.db) {
    const allowed = new Set(['report_channel_id','audit_channel_id','timezone','late_after_minutes','recording_enabled','recording_auto_start','auto_backup_enabled','auto_backup_hour','autopilot_enabled','autopilot_readiness_minutes','autopilot_reminder_minutes','autopilot_start_grace_minutes','autopilot_empty_end_minutes','autopilot_no_show_end_minutes','task_reminders_enabled']);
    const entries = Object.entries(patch).filter(([k]) => allowed.has(k));if (!entries.length) return this.getSettings(guildId, client);
    const sets = entries.map(([k], i) => `${k}=$${i+2}`).join(', ');const values = entries.map(([,v]) => v);
    const { rows } = await client.query(`UPDATE settings SET ${sets}, updated_at=now() WHERE guild_id=$1 RETURNING *`, [guildId, ...values]);const value=rows[0];
    if(client===this.db)this.settingsCache.set(this._settingsKey(guildId),{value,expiresAt:Date.now()+this.settingsTtlMs});
    else this.settingsCache.delete(this._settingsKey(guildId));
    return value;
  }
}
