import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {subjectFromInteraction} from '../context.js';

const SEND_LIMIT=8*1024*1024;

function clip(value,max=100){
  const s=String(value??'').trim();
  return s.length>max?s.slice(0,Math.max(1,max-1))+'…':s;
}

function safeFileName(value){
  const base=String(value??'اجتماع')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,110) || 'اجتماع';
  return `${base}.ogg`;
}

function navRows(extra=[]){
  const rows=[...extra];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('recording:list')
      .setLabel('رجوع للتسجيلات')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:refresh')
      .setLabel('الرئيسية')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary),
  ));
  return rows.slice(0,5);
}

async function visibleMeetings(a,s){
  const {rows}=await a.db.query(`
    SELECT
      m.id AS meeting_id,
      m.name AS meeting_name,
      m.team_id,
      t.name AS team_name,
      MAX(r.started_at) AS latest_started_at,
      COUNT(r.id)::int AS recording_count,
      BOOL_OR(
        CASE
          WHEN r.final_paths IS NULL THEN false
          WHEN jsonb_typeof(r.final_paths) <> 'array' THEN false
          ELSE jsonb_array_length(r.final_paths) > 0
        END
      ) AS has_final
    FROM meetings m
    JOIN teams t ON t.id=m.team_id
    JOIN recordings r ON r.meeting_id=m.id
    WHERE m.guild_id=$1
    GROUP BY m.id,m.name,m.team_id,t.name
    ORDER BY MAX(r.started_at) DESC
    LIMIT 50
  `,[s.guildId]);

  const out=[];
  for(const row of rows){
    let ok=false;
    try{
      ok=await a.permissionService.has(
        s,
        'recordings.view',
        {teamId:row.team_id,meetingId:row.meeting_id}
      );
    }catch{}
    if(ok || a.permissionService.isOwner?.(s.userId)) out.push(row);
    if(out.length>=25) break;
  }
  return out;
}

async function list(i,a,s){
  const rows=await visibleMeetings(a,s);

  if(!rows.length){
    return i.update({
      content:'🎙️ **التسجيلات**\nلا توجد تسجيلات متاحة لحسابك.',
      embeds:[],
      components:navRows([]),
      files:[],
    });
  }

  const options=rows.map((r,idx)=>({
    label:clip(r.meeting_name || `اجتماع ${idx+1}`,100),
    description:clip(
      `${r.team_name} • ${r.has_final?'ملف نهائي محفوظ':'مقاطع خام'} • ${r.recording_count} سجل`,
      100
    ),
    value:String(r.meeting_id),
    emoji:r.has_final?'🎧':'🎙️',
  }));

  const select=new StringSelectMenuBuilder()
    .setCustomId('recording:open')
    .setPlaceholder('اختر اجتماعًا لفتح التسجيل')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return i.update({
    content:`🎙️ **التسجيلات**\nاختر اجتماعًا من القائمة — ${rows.length} متاح.`,
    embeds:[],
    components:navRows([new ActionRowBuilder().addComponents(select)]),
    files:[],
  });
}

async function statAudio(file){
  try{
    const st=await fs.stat(String(file));
    if(st.isFile() && st.size>=100) return {path:String(file),size:st.size};
  }catch{}
  return null;
}

async function show(i,a,s,meetingId){
  const {rows}=await a.db.query(`
    SELECT
      m.id AS meeting_id,
      m.name AS meeting_name,
      m.team_id,
      t.name AS team_name,
      r.id AS recording_id,
      r.status AS recording_status,
      r.storage_path,
      r.final_paths,
      r.final_bytes,
      r.started_at
    FROM meetings m
    JOIN teams t ON t.id=m.team_id
    JOIN recordings r ON r.meeting_id=m.id
    WHERE m.id=$1 AND m.guild_id=$2
    ORDER BY r.started_at DESC
  `,[meetingId,s.guildId]);

  if(!rows.length){
    return i.update({
      content:'لا يوجد تسجيل محفوظ لهذا الاجتماع.',
      embeds:[],
      components:navRows([]),
      files:[],
    });
  }

  const base=rows[0];

  await a.permissionService.assert(
    s,
    'recordings.view',
    {teamId:base.team_id,meetingId:base.meeting_id}
  );

  // مهم: قد يوجد أكثر من Recording row للاجتماع نفسه.
  // لا نكتفي بأحدث row؛ نبحث في الجميع عن أي final_paths صالح فعليًا.
  let final=null;
  let finalOwner=null;

  for(const row of rows){
    const finals=Array.isArray(row.final_paths)?row.final_paths:[];
    for(const file of finals){
      const hit=await statAudio(file);
      if(hit){
        final=hit;
        finalOwner=row;
        break;
      }
    }
    if(final) break;
  }

  // Recovery fallback: لو قاعدة البيانات لم تعد تشير للملف لكن الملف النهائي
  // ما زال داخل storage_path، ابحث عن ملف باسم الاجتماع في كل Recording row.
  if(!final){
    const wanted=safeFileName(base.meeting_name);
    for(const row of rows){
      if(!row.storage_path) continue;
      const candidate=path.join(String(row.storage_path),wanted);
      const hit=await statAudio(candidate);
      if(hit){
        final=hit;
        finalOwner=row;
        break;
      }
    }
  }

  if(final){
    const sizeMb=(final.size/1024/1024).toFixed(2);

    if(final.size<=SEND_LIMIT){
      return i.update({
        content:[
          '🎧 **تسجيل الاجتماع**',
          `الاجتماع: **${base.meeting_name}**`,
          `الفريق: **${base.team_name}**`,
          'الحالة: **جاهز**',
          `الحجم: **${sizeMb} MB**`,
          rows.length>1?`سجلات التسجيل المرتبطة بالاجتماع: **${rows.length}**`:'',
        ].filter(Boolean).join('\n'),
        embeds:[],
        components:navRows([]),
        files:[{
          attachment:final.path,
          name:safeFileName(base.meeting_name),
        }],
      });
    }

    return i.update({
      content:[
        '🎧 **تسجيل الاجتماع جاهز**',
        `الاجتماع: **${base.meeting_name}**`,
        `الحجم: **${sizeMb} MB**`,
        '',
        'الملف النهائي موجود على جهاز التشغيل لكنه أكبر من حد الإرسال المحافظ لهذه اللوحة.',
      ].join('\n'),
      embeds:[],
      components:navRows([]),
      files:[],
    });
  }

  // إذا لم نجد final في أي row، نجمع المقاطع الخام من جميع rows بدل أحدث row فقط.
  const raw=[];
  for(const row of rows){
    const tracks=await a.recordings.tracks(row.recording_id).catch(()=>[]);
    for(const t of tracks){
      if(raw.length>=10) break;
      const hit=await statAudio(t.path);
      if(hit) raw.push({...hit,raw:true});
    }
    if(raw.length>=10) break;
  }

  if(!raw.length){
    return i.update({
      content:[
        `🎙️ **${base.meeting_name}**`,
        'لا يوجد ملف نهائي ولا مقاطع خام صالحة على القرص.',
        `سجلات التسجيل التي تم فحصها: **${rows.length}**`,
      ].join('\n'),
      embeds:[],
      components:navRows([]),
      files:[],
    });
  }

  const sendable=raw.filter(x=>x.size<=SEND_LIMIT);
  return i.update({
    content:[
      `🎙️ **${base.meeting_name}**`,
      'لم يوجد ملف نهائي صالح في أي سجل؛ يتم عرض المقاطع الخام المتاحة.',
      `المقاطع الصالحة المعروضة: **${sendable.length}**`,
      `سجلات التسجيل المفحوصة: **${rows.length}**`,
    ].join('\n'),
    embeds:[],
    components:navRows([]),
    files:sendable.map((x,idx)=>({
      attachment:x.path,
      name:`${clip(base.meeting_name,70)} - خام ${idx+1}${path.extname(x.path)||'.ogg'}`,
    })),
  });
}

export async function handleRecordings(i,a){
  const s=await subjectFromInteraction(i,a.env);
  const id=String(i.customId??'');

  if(id==='admin:recordings' || id==='recording:list'){
    await list(i,a,s);
    return true;
  }

  if(id==='recording:open'){
    const meetingId=String(i.values?.[0]??'');
    if(!meetingId){
      await list(i,a,s);
      return true;
    }
    await show(i,a,s,meetingId);
    return true;
  }

  if(id.startsWith('recording:') && id!=='recording:list'){
    const maybe=id.slice('recording:'.length);
    if(maybe && maybe!=='open'){
      await show(i,a,s,maybe);
      return true;
    }
  }

  return false;
}
