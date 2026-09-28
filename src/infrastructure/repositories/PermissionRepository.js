import { TEAM_MANAGER_BUNDLE } from '../../core/permissions/teamManager.js';
export class PermissionRepository {
  constructor(db){this.db=db;this.revision=0;}
  _bump(){this.revision++;}
  getRevision(){return this.revision;}
  touchRevision(){this._bump();}
  async grantsFor({guildId,userId,roleIds=[]}) {
    const roles=(roleIds??[]).map(String);
    const {rows}=await this.db.query(`
      SELECT permission_key,effect,scope_type,scope_id,'user'::text source
      FROM user_permissions
      WHERE guild_id=$1 AND user_id=$2
      UNION ALL
      SELECT permission_key,effect,scope_type,scope_id,'role'::text source
      FROM role_permissions
      WHERE guild_id=$1 AND role_id=ANY($3::bigint[])
      UNION ALL
      SELECT tp.permission_key,tp.effect,tp.scope_type,tp.scope_id,'team'::text source
      FROM team_permissions tp
      JOIN team_members tm ON tm.team_id=tp.team_id
      WHERE tp.guild_id=$1
        AND tm.guild_id=$1
        AND tm.user_id=$2
        AND tm.active=true
      UNION ALL
      SELECT
        p.permission_key,
        'allow'::text AS effect,
        'team'::text AS scope_type,
        tm.team_id::text AS scope_id,
        'team_manager'::text AS source
      FROM team_managers tm
      JOIN team_members active_tm
        ON active_tm.team_id=tm.team_id
       AND active_tm.guild_id=tm.guild_id
       AND active_tm.user_id=tm.user_id
       AND active_tm.active=true
      CROSS JOIN LATERAL unnest($4::text[]) AS p(permission_key)
      WHERE tm.guild_id=$1
        AND tm.user_id=$2
    `,[guildId,userId,roles,TEAM_MANAGER_BUNDLE]);
    return rows;
  }
  async grantUser({guildId,userId,permission,effect='allow',scopeType='global',scopeId=null,actorId},client=this.db){const r=await client.query(`INSERT INTO user_permissions(guild_id,user_id,permission_key,effect,scope_type,scope_id,granted_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[guildId,userId,permission,effect,scopeType,scopeId,actorId]);if(r.rowCount)this._bump();}
  async grantRole({guildId,roleId,permission,effect='allow',scopeType='global',scopeId=null,actorId},client=this.db){const r=await client.query(`INSERT INTO role_permissions(guild_id,role_id,permission_key,effect,scope_type,scope_id,granted_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[guildId,roleId,permission,effect,scopeType,scopeId,actorId]);if(r.rowCount)this._bump();}
  async grantTeam({guildId,teamId,permission,effect='allow',scopeType='team',scopeId=null,actorId},client=this.db){const r=await client.query(`INSERT INTO team_permissions(guild_id,team_id,permission_key,effect,scope_type,scope_id,granted_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[guildId,teamId,permission,effect,scopeType,scopeId,actorId]);if(r.rowCount)this._bump();}
  async listSubject({guildId,type,id}){const table=type==='user'?'user_permissions':type==='role'?'role_permissions':'team_permissions';const col=type==='user'?'user_id':type==='role'?'role_id':'team_id';const {rows}=await this.db.query(`SELECT id,permission_key,effect,scope_type,scope_id FROM ${table} WHERE guild_id=$1 AND ${col}=$2 ORDER BY permission_key`,[guildId,id]);return rows;}
  async revoke({type,grantId},client=this.db){const table=type==='user'?'user_permissions':type==='role'?'role_permissions':'team_permissions';const {rows}=await client.query(`DELETE FROM ${table} WHERE id=$1 RETURNING *`,[grantId]);if(rows.length)this._bump();return rows[0]??null;}
  async usersWithDirectPermission({guildId,permission},client=this.db){const {rows}=await client.query(`SELECT id,user_id,permission_key,effect,scope_type,scope_id,granted_by,created_at FROM user_permissions WHERE guild_id=$1 AND permission_key=$2 AND effect='allow' AND scope_type='global' AND scope_id IS NULL ORDER BY created_at`,[guildId,permission]);return rows;}
  async hasDirectUserPermission({guildId,userId,permission},client=this.db){const {rowCount}=await client.query(`SELECT 1 FROM user_permissions WHERE guild_id=$1 AND user_id=$2 AND permission_key=$3 AND effect='allow' AND scope_type='global' AND scope_id IS NULL LIMIT 1`,[guildId,userId,permission]);return rowCount>0;}
  async revokeDirectUserPermission({guildId,userId,permission},client=this.db){const {rows}=await client.query(`DELETE FROM user_permissions WHERE guild_id=$1 AND user_id=$2 AND permission_key=$3 AND effect='allow' AND scope_type='global' AND scope_id IS NULL RETURNING *`,[guildId,userId,permission]);if(rows.length)this._bump();return rows;}
}
