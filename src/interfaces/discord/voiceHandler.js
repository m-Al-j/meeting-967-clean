// test-lab-v1.9.3.8:auto-end-helper
const testLabAutoEndLocksV1938=new Set();

async function maybeAutoEndTestLabV1938(oldState,newState,app){
  if(!app.testLabService?.active || !app.testLabService?.end)return;

  const guild=newState.guild ?? oldState.guild;
  const guildId=String(guild?.id ?? '');
  const oldChannelId=String(oldState.channelId ?? '');
  if(!guildId || !oldChannelId)return;

  const userId=String(oldState.id ?? newState.id ?? '');
  const member=
    oldState.member ??
    newState.member ??
    guild.members.cache.get(userId) ??
    null;

  // A bot/Worker leaving does not trigger auto-end.
  if(member?.user?.bot)return;

  const run=await app.testLabService.active(guildId).catch(()=>null);
  if(
    !run ||
    run.status==='ending' ||
    String(run.voice_channel_id)!==oldChannelId
  )return;

  const lockKey=String(run.id);
  if(testLabAutoEndLocksV1938.has(lockKey))return;

  await new Promise(resolve=>setTimeout(resolve,750));

  const channel=
    guild.channels.cache.get(oldChannelId) ??
    await guild.channels.fetch(oldChannelId).catch(()=>null);

  if(!channel?.isVoiceBased?.())return;

  // Bots/Workers do not keep Test Lab alive.
  const humans=[...channel.members.values()].filter(m=>!m.user?.bot);
  if(humans.length>0)return;

  testLabAutoEndLocksV1938.add(lockKey);

  try{
    app.logger?.info?.('test-lab-auto-end-empty-channel',{
      runId:run.id,
      meetingId:run.meeting_id,
      voiceChannelId:oldChannelId,
    });

    await app.testLabService.end({
      guild,
      actorId:String(app.env?.OWNER_USER_ID ?? userId),
    });

    app.logger?.info?.('test-lab-auto-ended',{
      runId:run.id,
      meetingId:run.meeting_id,
    });
  }catch(error){
    app.logger?.error?.('test-lab-auto-end-failed',{
      runId:run.id,
      meetingId:run.meeting_id,
      error:error?.stack ?? String(error),
    });
  }finally{
    testLabAutoEndLocksV1938.delete(lockKey);
  }
}

// test-lab-v1.9.4.1:dynamic-participants
async function ensureTestLabParticipantV1941(oldState,newState,app){
  const guild=newState.guild ?? oldState.guild;
  const guildId=String(guild?.id ?? '');
  const newChannelId=String(newState.channelId ?? '');
  if(!guildId || !newChannelId || !app.testLabService?.active)return;

  const member=
    newState.member ??
    oldState.member ??
    guild.members.cache.get(String(newState.id ?? oldState.id ?? '')) ??
    null;

  // Never enroll bots / Recording Workers.
  if(!member || member.user?.bot)return;

  const run=await app.testLabService.active(guildId).catch(()=>null);
  if(
    !run ||
    run.status==='ending' ||
    String(run.voice_channel_id)!==newChannelId
  )return;

  const userId=String(member.id);
  const displayName=String(
    member.displayName ??
    member.user?.globalName ??
    member.user?.username ??
    userId
  ).slice(0,200);

  await app.db.query(
    `INSERT INTO meeting_member_snapshots(meeting_id,user_id,display_name,team_id)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(meeting_id,user_id) DO NOTHING`,
    [run.meeting_id,userId,displayName,run.team_id],
  );

  await app.db.query(
    `INSERT INTO attendance(meeting_id,user_id,status)
     VALUES($1,$2,'absent')
     ON CONFLICT(meeting_id,user_id) DO NOTHING`,
    [run.meeting_id,userId],
  );

  app.logger?.info?.('test-lab-participant-enrolled',{
    runId:run.id,
    meetingId:run.meeting_id,
    userId,
  });
}

export async function handleVoiceState(oldState,newState,app){try{const guildId=newState.guild.id;const userId=newState.id;const oldId=oldState.channelId;const newId=newState.channelId;if(oldId===newId)return;
  await ensureTestLabParticipantV1941(oldState,newState,app);
  if(oldId){const m=await app.attendance.activeMeetingByChannel(guildId,oldId);if(m){const snap=await app.db.query('SELECT 1 FROM meeting_member_snapshots WHERE meeting_id=$1 AND user_id=$2',[m.id,userId]);if(snap.rowCount)await app.attendanceService.left(m,userId,new Date());}}
  if(newId){const m=await app.attendance.activeMeetingByChannel(guildId,newId);if(m){const snap=await app.db.query('SELECT 1 FROM meeting_member_snapshots WHERE meeting_id=$1 AND user_id=$2',[m.id,userId]);if(snap.rowCount)await app.attendanceService.joined(m,userId,new Date());}}
  await maybeAutoEndTestLabV1938(oldState,newState,app);
}catch(e){app.logger.error('voice handler error',{error:e.stack??e.message});}}
export async function reconcileVoice(app,guild){const active=await app.meetings.listForGuild(guild.id,{statuses:['ongoing'],limit:25,includeTest:true});for(const m of active){const channel=await guild.channels.fetch(String(m.voice_channel_id)).catch(()=>null);if(!channel?.isVoiceBased())continue;for(const member of channel.members.values()){const snap=await app.db.query('SELECT 1 FROM meeting_member_snapshots WHERE meeting_id=$1 AND user_id=$2',[m.id,member.id]);if(snap.rowCount)await app.attendanceService.joined(m,member.id,new Date());}}}
