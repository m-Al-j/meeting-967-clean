export async function subjectFromInteraction(interaction, env){
  const raw=interaction?.__rawInteraction??interaction;
  if(raw.__meeting967SubjectPromise)return raw.__meeting967SubjectPromise;
  const promise=(async()=>{
    const guild=interaction.guild??interaction.client.guilds.cache?.get?.(env.GUILD_ID)??await interaction.client.guilds.fetch(env.GUILD_ID);
    let member=interaction.member;
    if(!member||!member.roles?.cache){
      member=guild.members.cache?.get?.(interaction.user.id)??null;
      if(!member)member=await guild.members.fetch(interaction.user.id).catch(()=>null);
    }
    const roleIds=member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    return {guild,guildId:guild.id,userId:interaction.user.id,roleIds,member};
  })();
  try{raw.__meeting967SubjectPromise=promise;}catch{}
  return promise;
}
