import { z } from 'zod';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { withTransaction } from '../../infrastructure/db/pool.js';
import { bestNamed, findSpecialTextChannel, hasTeamMarker, isLikelySystemRole, normalizeStructureName, membersWithRole } from '../../core/teams/serverDiscovery.js';
import { roleIdForTeamDeletion, isDiscordRoleExcluded } from '../../core/teams/deletionPolicy.js';

export class TeamService{
  constructor({teams,guilds,audit}){this.teams=teams;this.guilds=guilds;this.audit=audit;this._supportSyncActorId=null;}
  async create({guildId,name,description='',actorId,sourceType='manual'}){name=z.string().trim().min(2).max(80).parse(name);description=z.string().max(500).parse(description??'');return withTransaction(async c=>{const team=await this.teams.create({guildId,name,description,actorId,sourceType},c);await this.audit.log({guildId,actorId,action:'team.create',targetType:'team',targetId:team.id,newValue:team},c);return team;});}
  async addMember({guildId,teamId,user,actorId}){return withTransaction(async c=>{await this.guilds.upsertUser({userId:user.id,username:user.username,displayName:user.displayName??user.globalName??user.username},c);await this.guilds.ensureMember(guildId,user.id,c);await this.teams.addMember({guildId,teamId,userId:user.id},c);await this.audit.log({guildId,actorId,action:'team.member.add',targetType:'team',targetId:teamId,newValue:{userId:user.id}},c);});}
  async removeMember({guildId,teamId,userId,actorId}){return withTransaction(async c=>{await this.teams.removeMember({teamId,userId},c);await this.audit.log({guildId,actorId,action:'team.member.remove',targetType:'team',targetId:teamId,oldValue:{userId}},c);});}
  async moveMember({guildId,fromTeamId,toTeamId,user,actorId}){return withTransaction(async c=>{await this.guilds.upsertUser({userId:user.id,username:user.username,displayName:user.displayName??user.globalName??user.username},c);await this.guilds.ensureMember(guildId,user.id,c);await this.teams.removeMember({teamId:fromTeamId,userId:user.id},c);await this.teams.addMember({guildId,teamId:toTeamId,userId:user.id},c);await this.audit.log({guildId,actorId,action:'team.member.move',targetType:'member',targetId:user.id,oldValue:{teamId:fromTeamId},newValue:{teamId:toTeamId}},c);});}

  async syncFromRole({guild,teamId,actorId,skipMemberFetch=false,memberCollection=null}){
    const team=await this.teams.get(teamId);
    if(!team?.discord_role_id)throw new Error('الفريق غير مربوط برتبة Discord.');
    let sourceMembers=memberCollection;
    if(!skipMemberFetch){sourceMembers=await guild.members.fetch({withPresences:false});}
    sourceMembers=sourceMembers??guild.members.cache;
const expectedMemberCount=Number(guild.memberCount??0);
if(skipMemberFetch && expectedMemberCount>0 && sourceMembers.size<expectedMemberCount){
  throw new Error(`INCOMPLETE_MEMBER_COLLECTION:${sourceMembers.size}/${expectedMemberCount}`);
}
const role=await guild.roles.fetch(String(team.discord_role_id));
    if(!role)throw new Error('رتبة Discord المرتبطة غير موجودة.');

    // نستخدم مجموعة الأعضاء التي جلبها Discord كاملة، لا Presence ولا قائمة المتصلين.
    // بذلك يدخل في الفريق كل عضو يحمل الرتبة سواء كان Online أو Offline.
    const desired=new Map(membersWithRole(sourceMembers,role.id).map(m=>[String(m.id),m]));
    const existing=await this.teams.members(teamId);const existingIds=new Set(existing.map(m=>String(m.user_id)));
    let added=0,removed=0;
    for(const [id,m] of desired){
      await this.guilds.upsertUser({userId:m.id,username:m.user.username,displayName:m.displayName??m.user.globalName??m.user.username});
      await this.guilds.ensureMember(guild.id,m.id);
      if(existingIds.has(id))continue;
      await this.teams.addMember({guildId:guild.id,teamId,userId:m.id});
      added++;
    }
    for(const m of existing){const id=String(m.user_id);if(desired.has(id))continue;await this.teams.removeMember({teamId,userId:id});removed++;}
    await this.audit.log({guildId:guild.id,actorId,action:'team.role.sync',targetType:'team',targetId:teamId,newValue:{roleId:String(role.id),members:desired.size,added,removed,source:'all-role-members'}});
    return {role,members:desired.size,added,removed};
  }

  async discoverServer({guild,refreshMembers=true}){
    await Promise.all([guild.roles.fetch(),guild.channels.fetch()]);
    let memberFetchError=null;
    let members=guild.members.cache;
    if(refreshMembers){
      try{members=await guild.members.fetch({withPresences:false});}
      catch(error){memberFetchError=error;members=guild.members.cache;}
    }
    const channels=[...guild.channels.cache.values()];
    const categories=channels.filter(c=>c.type===ChannelType.GuildCategory);
    const voices=channels.filter(c=>c.type===ChannelType.GuildVoice||c.type===ChannelType.GuildStageVoice);
    const texts=channels.filter(c=>c.type===ChannelType.GuildText||c.type===ChannelType.GuildAnnouncement);
    const roles=[...guild.roles.cache.values()].filter(role=>{
      if(String(role.id)===String(guild.id)||role.managed||isLikelySystemRole(role.name))return false;
      if(role.permissions.has(PermissionFlagsBits.Administrator)||role.permissions.has(PermissionFlagsBits.ManageGuild))return false;
      return true;
    }).sort((a,b)=>b.position-a.position);

    const teams=[];const skipped=[];
    for(const role of roles){
      const categoryHit=bestNamed(categories,role.name,{minScore:72});
      const directVoice=bestNamed(voices,role.name,{minScore:72,preferKeywords:['اجتماع','meeting']});
      const directText=bestNamed(texts,role.name,{minScore:72,preferKeywords:['تنبيه','اعلان','إعلان','announcement']});
      const evidence=hasTeamMarker(role.name)||Boolean(categoryHit)||Boolean(directVoice)||Boolean(directText);
      if(!evidence){skipped.push(role.name);continue;}

      let voice=directVoice?.item??null,text=directText?.item??null,category=categoryHit?.item??null;
      if(category){
        const insideVoice=voices.filter(c=>String(c.parentId??'')===String(category.id));
        const insideText=texts.filter(c=>String(c.parentId??'')===String(category.id));
        if(insideVoice.length){
          voice=bestNamed(insideVoice,role.name,{minScore:35,preferKeywords:['اجتماع','meeting','صوت']})?.item
            ??insideVoice.find(c=>/اجتماع|meeting|voice|صوت/iu.test(c.name))??insideVoice[0];
        }
        if(insideText.length){
          text=insideText.find(c=>/تنبيه|اعلان|إعلان|announcement|meeting|اجتماع/iu.test(c.name))
            ??bestNamed(insideText,role.name,{minScore:35})?.item??insideText[0];
        }
      }
      const memberCount=membersWithRole(members,role.id).length;
      teams.push({role,voice,text,category,memberCount});
    }

    return {teams,skipped,memberFetchError,members,reportChannel:findSpecialTextChannel(texts,'report'),auditChannel:findSpecialTextChannel(texts,'audit')};
  }


  async syncSupportRoleChannelAccess({
    guild,
    reason='Meeting 967 — exact support-role permission sync'
  }){
    await guild.roles.fetch().catch(()=>null);
    await guild.channels.fetch().catch(()=>null);

    const roles=[...guild.roles.cache.values()];

    const definitions=[

      {
        team:'الموارد البشرية',
        support:'مساند الموارد البشرية',
        color:0x36A269
      },
      {
        team:'الفريق الإعلامي',
        support:'مساند الفريق الإعلامي',
        color:0xC05A9E
      },
      {
        team:'الفريق التنفيذي',
        support:'مساند الفريق التنفيذي',
        color:0xD58A3A
      },
      {
        team:'التقنية والبحث',
        support:'مساند التقنية والبحث',
        color:0x3D82B8
      },
      {
        team:'الاداره والحوكمة',
        support:'مساند الاداره والحوكمة',
        color:0x7769A8
      }
    ];

    const channels=[
      ...guild.channels.cache.values()
    ].filter(channel =>
      !channel.isDMBased?.() &&
      !channel.isThread?.() &&
      Boolean(channel.permissionOverwrites?.cache)
    );

    let rolesUpdated=0;
    let overwritesUpdated=0;
    let overwritesRemoved=0;
    let skipped=0;
    let errors=0;

    const details=[];

    for(const definition of definitions){
      const teamRole=roles.find(role =>
        String(role.name??'').trim()===definition.team.trim()
      );

      const supportRole=roles.find(role =>
        String(role.name??'').trim()===definition.support.trim()
      );

      if(!teamRole || !supportRole){
        skipped++;

        details.push({
          team:definition.team,
          support:definition.support,
          status:'missing-role'
        });

        continue;
      }

      try{
        /*
         * لون رتبة المساند يكون ثابتًا ومميزًا حسب الفريق.
         */
        if(Number(supportRole.color ?? 0) !== Number(definition.color)){
          await supportRole.setColor(
            definition.color,
            `${reason} — support role color`
          );
        }

        /*
         * 1) نسخ صلاحيات Discord الأساسية للرتبة بالكامل.
         * لا نختار صلاحيات محددة؛ ننسخ Permission Bitfield نفسه.
         */
        await supportRole.setPermissions(
          teamRole.permissions,
          reason
        );

        rolesUpdated++;

        /*
         * 2) نسخ Channel Overwrites حرفيًا.
         *
         * إذا كانت رتبة الفريق لديها Override في قناة معينة:
         * نضع نفس allow + deny للمساند.
         *
         * وإذا لم يكن لرتبة الفريق Override في القناة:
         * نحذف Override الخاص بالمساند حتى لا يحصل على صلاحية
         * إضافية لا يملكها الفريق الأساسي.
         */
        for(const channel of channels){
          const teamOverwrite =
            channel.permissionOverwrites.cache.get(
              String(teamRole.id)
            );

          const supportOverwrite =
            channel.permissionOverwrites.cache.get(
              String(supportRole.id)
            );

          if(!teamOverwrite){
            if(supportOverwrite){
              await channel.permissionOverwrites.delete(
                supportRole,
                reason
              );

              overwritesRemoved++;
            }

            continue;
          }

          const permissions={};

          for(const permission of teamOverwrite.allow.toArray()){
            permissions[permission]=true;
          }

          for(const permission of teamOverwrite.deny.toArray()){
            permissions[permission]=false;
          }

          /*
           * Discord يحتاج Override فعلي إذا كان لدى رتبة الفريق
           * allow/deny على القناة.
           */
          if(Object.keys(permissions).length){
            await channel.permissionOverwrites.edit(
              supportRole,
              permissions,
              {reason}
            );

            overwritesUpdated++;
          }else if(supportOverwrite){
            await channel.permissionOverwrites.delete(
              supportRole,
              reason
            );

            overwritesRemoved++;
          }
        }

        details.push({
          team:definition.team,
          support:definition.support,
          status:'synced',
          permissions:String(teamRole.permissions.bitfield),
          channelsScanned:channels.length
        });

      }catch(error){
        errors++;

        details.push({
          team:definition.team,
          support:definition.support,
          status:'error',
          error:String(error?.message??error)
        });

        this.audit?.log?.({
          guildId:String(guild.id),
          actorId:this._supportSyncActorId??String(guild.ownerId??guild.id),
          action:'team.support_exact_permission_sync.failed',
          targetType:'discord_role',
          targetId:String(supportRole.id),
          newValue:{
            teamRoleId:String(teamRole.id),
            supportRoleId:String(supportRole.id),
            error:String(error?.message??error)
          }
        }).catch(()=>{});
      }
    }

    return {
      teams:definitions.length,
      rolesUpdated,
      overwritesUpdated,
      overwritesRemoved,
      skipped,
      errors,
      details
    };
  }

  async mergeUnlinkedDuplicates({guildId,canonical,actorId}){
    const all=await this.teams.list(guildId,{activeOnly:false});
    const key=normalizeStructureName(canonical.name);
    const duplicates=all.filter(t=>String(t.id)!==String(canonical.id)
      &&normalizeStructureName(t.name)===key
      &&!t.discord_role_id
      &&(t.source_type??'manual')==='manual');
    let merged=0;
    for(const duplicate of duplicates){
      await withTransaction(async c=>{
        await this.teams.mergeInto(duplicate.id,canonical.id,c);
        await this.audit.log({guildId,actorId,action:'team.duplicate.merge',targetType:'team',targetId:canonical.id,oldValue:{duplicateTeamId:duplicate.id,duplicateName:duplicate.name},newValue:{canonicalTeamId:canonical.id,canonicalName:canonical.name},metadata:{permissionsPreserved:true,meetingsPreserved:true,membersPreserved:true}},c);
      });
      merged++;
    }
    return merged;
  }


  async deleteTeam({guild,teamId,actorId,reason='حذف الفريق من Meeting 967'}){
    const team=await this.teams.get(teamId);
    if(!team||team.deleted_at)throw new Error('الفريق غير موجود أو محذوف مسبقًا.');
    if(guild)await guild.roles.fetch().catch(()=>null);
    const roleId=roleIdForTeamDeletion(team,guild?[...guild.roles.cache.values()]:[],guild?.id);
    const deleted=await withTransaction(async c=>{
      if(roleId)await this.teams.excludeDiscordRole({guildId:team.guild_id,roleId,actorId,reason},c);
      const row=await this.teams.markDeleted({teamId,actorId,reason},c);
      await this.audit.log({guildId:team.guild_id,actorId,action:'team.delete',targetType:'team',targetId:teamId,oldValue:{name:team.name,active:team.active,discord_role_id:team.discord_role_id},newValue:{deleted:true,excluded_discord_role_id:roleId},metadata:{discordRolePreserved:true,meetingHistoryPreserved:true}},c);
      return row;
    });
    return {team:deleted,roleId};
  }

  async cleanupLinkedDuplicates({guildId,actorId}){
    const all=await this.teams.list(guildId,{activeOnly:false});
    let merged=0;
    for(const canonical of all.filter(t=>t.discord_role_id))merged+=await this.mergeUnlinkedDuplicates({guildId,canonical,actorId});
    return merged;
  }

  async autoImportFromGuild({guild,actorId,refreshMembers=true}){
    await this.guilds.ensure({guildId:guild.id,name:guild.name,ownerUserId:actorId});
    const discovery=await this.discoverServer({guild,refreshMembers});
const memberCollectionComplete=
  !discovery.memberFetchError &&
  discovery.members.size>=Number(guild.memberCount??discovery.members.size);


    const excludedRoleIds=new Set(await this.teams.excludedDiscordRoleIds(guild.id));
    let created=0,updated=0,syncedMembers=0,added=0,removed=0,linkedVoice=0,linkedText=0,conflicts=0,mergedDuplicates=0,excluded=0;
    const imported=[];const errors=[];

    for(const d of discovery.teams){
      if(isDiscordRoleExcluded(d.role.id,excludedRoleIds)){excluded++;continue;}
      try{
        let team=await this.teams.findByDiscordRole(guild.id,d.role.id);
        if(!team){
          const all=await this.teams.list(guild.id,{activeOnly:false});
          const roleKey=normalizeStructureName(d.role.name);
          const normalizedCandidate=all.find(t=>!t.discord_role_id&&normalizeStructureName(t.name)===roleKey);
          team=normalizedCandidate??await this.teams.findByName(guild.id,d.role.name);
        }
        if(team?.discord_role_id&&String(team.discord_role_id)!==String(d.role.id)){
          conflicts++;
          errors.push({name:d.role.name,reason:'اسم الفريق موجود لكنه مربوط برتبة Discord مختلفة.'});
          continue;
        }
        if(!team){
          team=await this.create({guildId:guild.id,name:String(d.role.name).slice(0,80),description:'تم استيراده تلقائيًا من بنية Discord.',actorId,sourceType:'discord'});
          created++;
        }else{
          if(!team.active)team=await this.teams.setActive(team.id,true);
          updated++;
        }
        const patch={discord_role_id:String(d.role.id),source_type:'discord'};
        if(d.voice){patch.default_voice_channel_id=String(d.voice.id);linkedVoice++;}
        if(d.text){patch.notification_channel_id=String(d.text.id);linkedText++;}
        team=await this.teams.updateDiscordLinks(team.id,patch);

        // إذا كان هناك فريق يدوي قديم بنفس الاسم المنطقي، ندمجه في فريق Discord
        // بدل إبقاء نسختين. الدمج ينقل الاجتماعات والأعضاء والصلاحيات أولًا.
        mergedDuplicates+=await this.mergeUnlinkedDuplicates({guildId:guild.id,canonical:team,actorId});

        let sync={members:0,added:0,removed:0};
        if(memberCollectionComplete){
          sync=await this.syncFromRole({guild,teamId:team.id,actorId,skipMemberFetch:true,memberCollection:discovery.members});
          syncedMembers+=sync.members;added+=sync.added;removed+=sync.removed;
        }
        imported.push({teamId:team.id,name:team.name,roleId:String(d.role.id),voiceId:d.voice?String(d.voice.id):null,textId:d.text?String(d.text.id):null,members:sync.members});
      }catch(error){
        errors.push({name:d.role?.name??'رتبة غير معروفة',reason:String(error?.message??error).slice(0,300)});
      }
    }

    const settings=await this.guilds.getSettings(guild.id);const settingsPatch={};
    if(!settings?.report_channel_id&&discovery.reportChannel)settingsPatch.report_channel_id=String(discovery.reportChannel.id);
    if(!settings?.audit_channel_id&&discovery.auditChannel)settingsPatch.audit_channel_id=String(discovery.auditChannel.id);
    if(Object.keys(settingsPatch).length){
      try{await this.guilds.updateSettings(guild.id,settingsPatch);}catch(error){errors.push({name:'إعدادات القنوات',reason:String(error?.message??error).slice(0,300)});}
    }

    if(!memberCollectionComplete){
  errors.push({
    name:'أعضاء الفرق',
    reason:`تم تخطي مزامنة أعضاء الفرق لأن كاش Discord غير مكتمل (${discovery.members.size}/${guild.memberCount??0}).`
  });
}

if(discovery.memberFetchError){
      errors.push({name:'مزامنة الأعضاء',reason:'تعذر جلب القائمة الكاملة لأعضاء السيرفر؛ لم يتم حذف أعضاء قدامى حفاظًا على البيانات. تأكد من Server Members Intent.'});
    }

    const summary={created,updated,teams:imported.length,syncedMembers,added,removed,linkedVoice,linkedText,conflicts,mergedDuplicates,excluded,skipped:discovery.skipped.length,errors,reportChannelId:settingsPatch.report_channel_id??settings?.report_channel_id??null,auditChannelId:settingsPatch.audit_channel_id??settings?.audit_channel_id??null,imported};
    try{await this.audit.log({guildId:guild.id,actorId,action:'server.structure.auto_import',targetType:'guild',targetId:String(guild.id),newValue:summary});}catch{}
    return summary;
  }
}
