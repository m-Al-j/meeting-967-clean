import {randomUUID} from 'node:crypto';

export class RecordingRepository{
  constructor(db){this.db=db;}

  async start({
    meetingId,actorId,path,metadata={},
    recorderKey=null,recorderType=null,recorderUserId=null,workerNumber=null,teamScope=null,
    sessionReason='initial',failoverFromRecordingId=null,
  },client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(
      `WITH next_session AS (
         SELECT COALESCE(MAX(session_index),0)+1 AS n FROM recordings WHERE meeting_id=$2
       )
       INSERT INTO recordings(
         id,meeting_id,started_by,status,storage_path,metadata,
         recorder_key,recorder_type,recorder_user_id,worker_number,team_scope,
         session_index,session_reason,lease_heartbeat_at,failover_from_recording_id
       )
       SELECT $1,$2,$3,'recording',$4,$5,$6,$7,NULLIF($8,'')::bigint,$9,$10,
              next_session.n,$11,now(),NULLIF($12,'')::uuid
       FROM next_session
       RETURNING *`,
      [
        id,meetingId,actorId,path,metadata,recorderKey,recorderType,
        recorderUserId==null?'':String(recorderUserId),workerNumber,teamScope,
        sessionReason,failoverFromRecordingId==null?'':String(failoverFromRecordingId),
      ],
    );
    return rows[0];
  }

  async stop(id,status='completed',client=this.db){
    const {rows}=await client.query(
      `UPDATE recordings
       SET status=$2,stopped_at=COALESCE(stopped_at,now()),lease_heartbeat_at=now()
       WHERE id=$1 RETURNING *`,
      [id,status],
    );
    return rows[0];
  }

  async touchLease(id,at=new Date(),client=this.db){
    const {rows}=await client.query(
      `UPDATE recordings SET lease_heartbeat_at=$2 WHERE id=$1 AND status='recording' RETURNING id,lease_heartbeat_at`,
      [id,at],
    );
    return rows[0]??null;
  }

  async patchMetadata(id,patch={},client=this.db){
    const {rows}=await client.query(
      `UPDATE recordings SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id=$1 RETURNING *`,
      [id,JSON.stringify(patch??{})],
    );
    return rows[0]??null;
  }

  async setFinalFiles(id,paths=[],metadataPatch={},client=this.db){
    const files=Array.isArray(paths)?paths:[];
    let bytes=0;
    const fs=await import('node:fs/promises');
    for(const p of files){try{bytes+=(await fs.stat(p)).size;}catch{}}
    const metadata={
      finalFormat:'mixed Ogg Opus',
      finalParts:files.length,
      ...metadataPatch,
    };
    const {rows}=await client.query(
      `UPDATE recordings
       SET final_paths=$2::jsonb,
           final_bytes=$3,
           metadata=COALESCE(metadata,'{}'::jsonb) || $4::jsonb
       WHERE id=$1 RETURNING *`,
      [id,JSON.stringify(files),bytes,JSON.stringify(metadata)],
    );
    return rows[0];
  }

  async addTrack({recordingId,userId,path,startedAt,endedAt,packetCount,bytes,metadata={}},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(
      `INSERT INTO recording_tracks(id,recording_id,user_id,path,started_at,ended_at,packet_count,bytes,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id,recordingId,userId,path,startedAt,endedAt,packetCount,bytes,metadata],
    );
    return rows[0];
  }

  async failOpenForMeeting(meetingId,client=this.db){
    const {rows}=await client.query(
      `UPDATE recordings
       SET status='failed',
           stopped_at=COALESCE(stopped_at,now()),
           lease_heartbeat_at=now(),
           metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
             'recoveredByAutopilot',true,
             'recordingIntegrityRepository','recording-integrity-repository-v1.10.11',
             'integrityGuardVersion','1.10.11',
             'integrityStatus','needs_recovery',
             'integrityCompromised',true,
             'integrityCoverageEndedAt',now(),
             'integrityFailureReason','open-session-recovered-after-process-loss'
           )
       WHERE meeting_id=$1 AND status='recording'
       RETURNING *`,
      [meetingId],
    );
    return rows;
  }

  async latestForMeeting(meetingId){
    const {rows}=await this.db.query(
      'SELECT * FROM recordings WHERE meeting_id=$1 ORDER BY started_at DESC LIMIT 1',
      [meetingId],
    );
    return rows[0]??null;
  }

  async listForMeeting(meetingId){
    const {rows}=await this.db.query(
      'SELECT * FROM recordings WHERE meeting_id=$1 ORDER BY COALESCE(session_index,2147483647),started_at,id',
      [meetingId],
    );
    return rows;
  }

  async tracks(recordingId){
    const {rows}=await this.db.query(
      'SELECT * FROM recording_tracks WHERE recording_id=$1 ORDER BY started_at,id',
      [recordingId],
    );
    return rows;
  }

  async tracksForMeeting(meetingId){
    const {rows}=await this.db.query(
      `SELECT t.*,r.meeting_id,r.started_at AS recording_started_at,r.status AS recording_status,
              r.session_index,r.recorder_key,r.recorder_type,r.worker_number,r.session_reason
       FROM recording_tracks t
       JOIN recordings r ON r.id=t.recording_id
       WHERE r.meeting_id=$1
       ORDER BY t.started_at,t.id`,
      [meetingId],
    );
    return rows;
  }
}
