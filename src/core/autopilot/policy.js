const ms=(m)=>Math.max(0,Number(m)||0)*60_000;

export function autopilotWindow({scheduledAt,now=new Date(),readinessMinutes=30,reminderMinutes=15,startGraceMinutes=10}){
  const scheduled=new Date(scheduledAt).getTime();
  const current=new Date(now).getTime();
  const delta=scheduled-current;
  return {
    millisecondsUntilStart:delta,
    dueReadiness:delta<=ms(readinessMinutes)&&delta>0,
    dueReminder:delta<=ms(reminderMinutes)&&delta>0,
    dueStart:delta<=0&&delta>=-ms(startGraceMinutes),
    expired:delta < -ms(startGraceMinutes),
  };
}

export function autoEndDecision({startedAt,now=new Date(),humanCount=0,hadHuman=false,emptySince=null,emptyEndMinutes=2,noShowEndMinutes=15}){
  const current=new Date(now).getTime();
  const started=new Date(startedAt).getTime();
  if(humanCount>0)return {shouldEnd:false,reason:null,nextHadHuman:true,nextEmptySince:null};
  if(hadHuman){
    const since=emptySince?new Date(emptySince).getTime():current;
    return {
      shouldEnd:current-since>=ms(emptyEndMinutes),
      reason:'empty_after_attendance',
      nextHadHuman:true,
      nextEmptySince:new Date(since),
    };
  }
  return {
    shouldEnd:current-started>=ms(noShowEndMinutes),
    reason:'no_show',
    nextHadHuman:false,
    nextEmptySince:null,
  };
}
