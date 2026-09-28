CREATE UNIQUE INDEX IF NOT EXISTS uq_user_permissions_effective
ON user_permissions(guild_id,user_id,permission_key,effect,scope_type,COALESCE(scope_id,''));

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_effective
ON role_permissions(guild_id,role_id,permission_key,effect,scope_type,COALESCE(scope_id,''));

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_permissions_effective
ON team_permissions(guild_id,team_id,permission_key,effect,scope_type,COALESCE(scope_id,''));
