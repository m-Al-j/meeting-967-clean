export async function handleTeamRoleSync(oldMember,newMember,app){
  try{
    if(newMember.user?.bot)return;
    const teams=await app.teams.linkedTeams(newMember.guild.id);
    if(!teams.length)return;
    for(const team of teams){
      const roleId=String(team.discord_role_id);
      const had=oldMember.roles.cache.has(roleId);
      const has=newMember.roles.cache.has(roleId);
      if(had===has)continue;
      await app.guilds.upsertUser({userId:newMember.id,username:newMember.user.username,displayName:newMember.displayName});
      await app.guilds.ensureMember(newMember.guild.id,newMember.id);
      if(has){
        await app.teams.addMember({guildId:newMember.guild.id,teamId:team.id,userId:newMember.id});
        await app.audit.log({guildId:newMember.guild.id,actorId:newMember.id,action:'team.role.auto_add',targetType:'team',targetId:team.id,newValue:{userId:newMember.id,roleId}});
      }else{
        await app.teams.removeMember({teamId:team.id,userId:newMember.id});
        await app.audit.log({guildId:newMember.guild.id,actorId:newMember.id,action:'team.role.auto_remove',targetType:'team',targetId:team.id,oldValue:{userId:newMember.id,roleId}});
      }
    }
  }catch(error){app.logger.error('team role sync failed',{error:error?.stack??String(error),guildId:newMember.guild?.id,userId:newMember.id});}
}

export async function reconcileTeamRoleLinks(guild,app){
  try{
    const linked=await app.teams.linkedTeams(guild.id);if(!linked.length)return;
    const allMembers=guild.members.cache;
    const memberCount=Number(guild.memberCount??0);

    if(!allMembers.size || (memberCount>0 && allMembers.size<memberCount)){
      app.logger.warn('team role reconcile skipped: member cache incomplete',{
        guildId:guild.id,
        membersCached:allMembers.size,
        memberCount
      });
      return;
    }

    for(const team of linked){
      await app.teamService.syncFromRole({
        guild,
        teamId:team.id,
        actorId:app.env.OWNER_USER_ID,
        skipMemberFetch:true,
        memberCollection:allMembers
      });
    }

    app.logger.info('team role links reconciled',{
      guildId:guild.id,
      teams:linked.length,
      membersCached:allMembers.size,
      memberCount:guild.memberCount
    });
  }catch(error){app.logger.error('team role reconcile failed',{error:error?.stack??String(error),guildId:guild.id});}
}
