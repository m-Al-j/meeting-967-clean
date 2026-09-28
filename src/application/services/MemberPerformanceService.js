import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

const GOLD = 'A88424';
const BLACK = '202020';
const BEIGE = 'F5F1E6';
const PALE = 'FBF9F4';
const WHITE = 'FFFFFF';
const GRAY = '666666';
const BORDER = 'D8D1C2';
const GREEN = 'EAF3E8';
const AMBER = 'FFF3D8';
const RED = 'F8E8E8';
const FONT = 'Arial';

const asText = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const pct = (n) => `${Math.round(Number(n || 0))}%`;
const hasArabic = (v) => /[\u0600-\u06FF]/.test(String(v ?? ''));

function rtlRun(text, { bold = false, color = BLACK, size = 20 } = {}) {
  return new TextRun({ text: asText(text), bold, color, size, font: FONT, rightToLeft: true });
}
function ltrRun(text, { bold = false, color = BLACK, size = 20 } = {}) {
  return new TextRun({ text: asText(text), bold, color, size, font: FONT, rightToLeft: false });
}
function rtlP(text='', opt={}) {
  return new Paragraph({
    bidirectional: true,
    alignment: opt.alignment ?? AlignmentType.RIGHT,
    spacing: opt.spacing ?? { before: opt.before ?? 0, after: opt.after ?? 0, line: 260 },
    keepNext: opt.keepNext ?? false,
    children: String(asText(text)).split('\n').map((part,index)=>new TextRun({
      text: part,
      break: index ? 1 : 0,
      bold: opt.bold ?? false,
      color: opt.color ?? BLACK,
      size: opt.size ?? 20,
      font: FONT,
      rightToLeft: true,
    })),
  });
}
function ltrP(text='', opt={}) {
  return new Paragraph({
    bidirectional: false,
    alignment: opt.alignment ?? AlignmentType.LEFT,
    spacing: opt.spacing ?? { before: opt.before ?? 0, after: opt.after ?? 0, line: 260 },
    keepNext: opt.keepNext ?? false,
    children: String(asText(text)).split('\n').map((part,index)=>new TextRun({
      text: part,
      break: index ? 1 : 0,
      bold: opt.bold ?? false,
      color: opt.color ?? BLACK,
      size: opt.size ?? 20,
      font: FONT,
      rightToLeft: false,
    })),
  });
}

const thinBorders={
  top:{style:BorderStyle.SINGLE,size:3,color:BORDER},
  bottom:{style:BorderStyle.SINGLE,size:3,color:BORDER},
  left:{style:BorderStyle.SINGLE,size:3,color:BORDER},
  right:{style:BorderStyle.SINGLE,size:3,color:BORDER},
  insideHorizontal:{style:BorderStyle.SINGLE,size:3,color:BORDER},
  insideVertical:{style:BorderStyle.SINGLE,size:3,color:BORDER},
};
const noBorders={
  top:{style:BorderStyle.NONE,size:0,color:WHITE},
  bottom:{style:BorderStyle.NONE,size:0,color:WHITE},
  left:{style:BorderStyle.NONE,size:0,color:WHITE},
  right:{style:BorderStyle.NONE,size:0,color:WHITE},
  insideHorizontal:{style:BorderStyle.NONE,size:0,color:WHITE},
  insideVertical:{style:BorderStyle.NONE,size:0,color:WHITE},
};

function cell(text,{fill=WHITE,bold=false,color=BLACK,rtl=true,center=false,size=18,alignment=null}={}){
  const align=alignment ?? (center ? AlignmentType.CENTER : (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT));
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading:{type:ShadingType.CLEAR,fill},
    margins:{top:82,bottom:82,left:90,right:90},
    children:[rtl ? rtlP(text,{bold,color,size,alignment:align}) : ltrP(text,{bold,color,size,alignment:align})],
  });
}
const labelCell=(text)=>cell(text,{fill:BEIGE,bold:true,color:GOLD,rtl:true,size:17});
const ltrCell=(text,opt={})=>cell(text,{...opt,rtl:false});
const blackCell=(text,rtl=true)=>cell(text,{fill:BLACK,bold:true,color:WHITE,rtl,center:true,size:16});

function sectionBar(text){
  return new Table({
    width:{size:100,type:WidthType.PERCENTAGE},
    columnWidths:[9300],
    borders:noBorders,
    rows:[new TableRow({cantSplit:true,children:[cell(text,{fill:BLACK,bold:true,color:WHITE,rtl:true,size:19})]})],
  });
}

function infoTable(rows){
  return new Table({
    width:{size:100,type:WidthType.PERCENTAGE},
    columnWidths:[2050,2600,2050,2600],
    borders:thinBorders,
    rows:rows.map(([label1,value1,rtl1,label2,value2,rtl2])=>new TableRow({cantSplit:true,children:[
      labelCell(label1),
      cell(value1,{rtl:rtl1}),
      labelCell(label2),
      cell(value2,{rtl:rtl2}),
    ]})),
  });
}
function scoreFill(score){if(score===null)return BEIGE;if(score>=80)return GREEN;if(score>=60)return AMBER;return RED;}
function attendanceStatusArabic(value){return ({present:'حاضر',late:'متأخر',absent:'غائب',excused:'معتذر'})[value]||asText(value);}
function arrivalArabic(value){return value==='late'?'متأخر':value==='excused'?'عذر معتمد':value==='absent'?'—':'في الوقت';}
function taskStatusArabic(row){
  if(row.review_status==='approved')return 'مكتملة ومعتمدة';
  if(row.review_status==='submitted')return 'بانتظار المراجعة';
  if(row.review_status==='rejected')return 'أعيدت للتعديل';
  return ({pending:'لم يبدأ',in_progress:'قيد التنفيذ',done:'مكتملة',cancelled:'ملغاة'})[row.status]||asText(row.status);
}
function taskFill(row){
  if(row.review_status==='approved')return GREEN;
  if(row.review_status==='rejected')return RED;
  if(row.review_status==='submitted')return AMBER;
  if(row.status==='cancelled')return BEIGE;
  if(row.due_at&&new Date(row.due_at)<new Date())return AMBER;
  return WHITE;
}
function reviewDecision(row){
  if(row.review_status==='approved')return 'معتمد';
  if(row.review_status==='rejected')return row.review_note?`إعادة للتعديل: ${row.review_note}`:'إعادة للتعديل';
  if(row.review_status==='submitted')return 'بانتظار القرار';
  return '—';
}
function deliveryLabel(row){
  let files=row.latest_attachments;
  if(typeof files==='string'){try{files=JSON.parse(files);}catch{files=[];}}
  if(!Array.isArray(files))files=[];
  if(files.length===1){
    const name=String(files[0]?.name??'');
    const ext=name.includes('.')?name.split('.').pop().toUpperCase():'';
    return ext?`ملف ${ext}`:'ملف مرفق';
  }
  if(files.length>1)return `${files.length} ملفات`;
  if(row.latest_submission_note)return 'ملاحظة نصية';
  return '—';
}
function safeFilePart(value){return String(value??'').replace(/[<>:\"/\\|?*\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'performance-report';}
export class MemberPerformanceService {
  constructor({ db, audit, env }) { Object.assign(this, { db, audit, env }); }

  range(period) {
    const end = DateTime.utc();
    const start = period === 'month' ? end.minus({ days: 30 }) : end.minus({ days: 7 });
    return { start: start.toJSDate(), end: end.toJSDate() };
  }

  async metrics({ guildId, userId, period, teamIds = null }) {
    const { start, end } = this.range(period);
    const scope = Array.isArray(teamIds) && teamIds.length ? teamIds.map(String) : null;

    const { rows: userRows } = await this.db.query(
      'SELECT id,COALESCE(display_name,username,id::text) AS display_name,username FROM users WHERE id=$1',
      [userId],
    );
    const user = userRows[0] || { id: userId, display_name: String(userId), username: null };

    const { rows: attendanceAggregateRows } = await this.db.query(`
      SELECT
        COUNT(*)::int AS meetings,
        COUNT(*) FILTER(WHERE a.status IN ('present','late'))::int AS attended,
        COUNT(*) FILTER(WHERE a.status='late')::int AS late,
        COUNT(*) FILTER(WHERE a.status='absent')::int AS absent,
        COUNT(*) FILTER(WHERE a.status='excused')::int AS excused,
        COALESCE(AVG(a.presence_ratio)*100,0)::numeric AS avg_presence
      FROM meeting_member_snapshots s
      JOIN meetings m ON m.id=s.meeting_id
      LEFT JOIN attendance a ON a.meeting_id=s.meeting_id AND a.user_id=s.user_id
      WHERE m.guild_id=$1 AND s.user_id=$2 AND m.status='ended'
        AND COALESCE(m.ended_at,m.scheduled_at)>=$3
        AND COALESCE(m.ended_at,m.scheduled_at)<$4
        AND ($5::uuid[] IS NULL OR m.team_id=ANY($5::uuid[]))`,
      [guildId, userId, start, end, scope],
    );
    const att = attendanceAggregateRows[0] || { meetings: 0, attended: 0, late: 0, absent: 0, excused: 0, avg_presence: 0 };

    const { rows: taskAggregateRows } = await this.db.query(`
      SELECT
        COUNT(*) FILTER(WHERE status<>'cancelled')::int AS assigned,
        COUNT(*) FILTER(WHERE status='done' AND review_status='approved')::int AS approved,
        COUNT(*) FILTER(WHERE review_status='submitted')::int AS submitted,
        COUNT(*) FILTER(WHERE review_status='rejected')::int AS rejected,
        COUNT(*) FILTER(WHERE status IN ('pending','in_progress') AND due_at IS NOT NULL AND due_at<now())::int AS overdue,
        COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled
      FROM meeting_tasks
      WHERE guild_id=$1 AND assignee_user_id=$2 AND created_at<$4
        AND (created_at>=$3 OR updated_at>=$3 OR due_at>=$3)
        AND ($5::uuid[] IS NULL OR team_id=ANY($5::uuid[]))`,
      [guildId, userId, start, end, scope],
    );
    const task = taskAggregateRows[0] || { assigned: 0, approved: 0, submitted: 0, rejected: 0, overdue: 0, cancelled: 0 };

    const { rows: teams } = await this.db.query(`
      SELECT DISTINCT t.name
      FROM team_members tm JOIN teams t ON t.id=tm.team_id
      WHERE tm.guild_id=$1 AND tm.user_id=$2 AND tm.active=true AND t.deleted_at IS NULL
        AND ($3::uuid[] IS NULL OR t.id=ANY($3::uuid[]))
      ORDER BY t.name`, [guildId, userId, scope]);

    const { rows: attendanceRows } = await this.db.query(`
      SELECT m.id,m.name,m.scheduled_at,m.ended_at,
             COALESCE(a.status,'absent') AS status,
             COALESCE(a.presence_ratio,0)::numeric AS presence_ratio
      FROM meeting_member_snapshots s
      JOIN meetings m ON m.id=s.meeting_id
      LEFT JOIN attendance a ON a.meeting_id=s.meeting_id AND a.user_id=s.user_id
      WHERE m.guild_id=$1 AND s.user_id=$2 AND m.status='ended'
        AND COALESCE(m.ended_at,m.scheduled_at)>=$3
        AND COALESCE(m.ended_at,m.scheduled_at)<$4
        AND ($5::uuid[] IS NULL OR m.team_id=ANY($5::uuid[]))
      ORDER BY COALESCE(m.ended_at,m.scheduled_at) ASC`,
      [guildId, userId, start, end, scope],
    );

    const { rows: taskRows } = await this.db.query(`
      SELECT mt.id,mt.title,mt.status,mt.review_status,mt.review_note,mt.due_at,mt.created_at,mt.updated_at,
             sub.note AS latest_submission_note,sub.attachments AS latest_attachments,sub.submitted_at AS latest_submitted_at
      FROM meeting_tasks mt
      LEFT JOIN LATERAL (
        SELECT note,attachments,submitted_at FROM task_submissions ts
        WHERE ts.task_id=mt.id ORDER BY submitted_at DESC LIMIT 1
      ) sub ON true
      WHERE mt.guild_id=$1 AND mt.assignee_user_id=$2 AND mt.created_at<$4
        AND (mt.created_at>=$3 OR mt.updated_at>=$3 OR mt.due_at>=$3)
        AND ($5::uuid[] IS NULL OR mt.team_id=ANY($5::uuid[]))
      ORDER BY COALESCE(mt.due_at,mt.created_at) ASC`,
      [guildId, userId, start, end, scope],
    );

    const attendanceScore = Number(att.meetings || 0) ? Number(att.avg_presence || 0) : null;
    const punctualityScore = Number(att.attended || 0)
      ? Math.max(0, 100 - (Number(att.late || 0) / Number(att.attended)) * 100)
      : null;
    const taskScore = Number(task.assigned || 0)
      ? Math.min(100, (Number(task.approved || 0) / Number(task.assigned)) * 100)
      : null;
    const parts = [];
    if (attendanceScore !== null) parts.push([attendanceScore, 45]);
    if (taskScore !== null) parts.push([taskScore, 45]);
    if (punctualityScore !== null) parts.push([punctualityScore, 10]);
    const denom = parts.reduce((s, x) => s + x[1], 0);
    const score = denom ? parts.reduce((s, [v, w]) => s + v * w, 0) / denom : null;
    const label = score === null ? 'لا توجد بيانات كافية'
      : score >= 90 ? 'ممتاز'
        : score >= 80 ? 'جيد جدًا'
          : score >= 70 ? 'جيد'
            : score >= 60 ? 'مقبول'
              : 'يحتاج متابعة';
    const evidence = Number(att.meetings || 0) + Number(task.assigned || 0);

    return {
      user,
      teams: teams.map((x) => x.name),
      period,
      start,
      end,
      attendance: { ...att, avg_presence: Number(att.avg_presence || 0) },
      tasks: task,
      attendanceRows,
      taskRows,
      score: score === null ? null : Math.round(score * 10) / 10,
      label,
      evidence,
      provisional: evidence < 3,
    };
  }

  async timezone(guildId) {
    try {
      const { rows } = await this.db.query('SELECT timezone FROM settings WHERE guild_id=$1', [guildId]);
      return rows[0]?.timezone || 'Asia/Aden';
    } catch {
      return 'Asia/Aden';
    }
  }

  async generate({ guildId, userId, period, actorId, teamIds = null }) {
    const m=await this.metrics({guildId,userId,period,teamIds});
    const zone=await this.timezone(guildId);
    const local=(value)=>DateTime.fromJSDate(new Date(value),{zone:'utc'}).setZone(zone);
    const fmtDate=(value)=>value?local(value).toFormat('dd/MM/yyyy'):'—';
    const fmtRange=(value)=>DateTime.fromJSDate(value,{zone:'utc'}).setZone(zone).toFormat('dd/MM/yyyy');
    const issue=DateTime.now().setZone(zone);
    const reportId=randomUUID();
    const reference=`PERF-${issue.toFormat('yyyy-MM-dd')}-${reportId.slice(0,6).toUpperCase()}`;
    const reportType=period==='month'?'شهري':'أسبوعي';
    const indicatorState=m.provisional?'مؤشر أولي':'تقييم كافٍ';
    const title=`تقرير تقييم أداء عضو - ${reportType}`;

    const logo=await fs.readFile(path.resolve('src','assets','meeting967-logo.png')).catch(()=>null);
    const children=[];
    if(logo)children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:55},children:[new ImageRun({data:logo,type:'png',transformation:{width:88,height:88}})]}));

    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      columnWidths:[4300,2800,2200],
      borders:noBorders,
      rows:[new TableRow({cantSplit:true,children:[
        ltrCell('967',{fill:GOLD,color:WHITE,bold:true,alignment:AlignmentType.LEFT,size:18}),
        cell('نظام التقييم والمتابعة',{fill:BLACK,bold:true,color:WHITE,rtl:true,center:true,size:17}),
        ltrCell('MEETING 967',{fill:BLACK,color:WHITE,bold:true,alignment:AlignmentType.CENTER,size:17}),
      ]})],
    }));
    children.push(rtlP(title,{bold:true,size:27,alignment:AlignmentType.CENTER,before:65,after:12}));
    children.push(rtlP('التقرير الرسمي لمتابعة الأداء والإنجاز',{color:GRAY,size:17,alignment:AlignmentType.CENTER,after:90}));

    children.push(infoTable([
      ['العضو',m.user.display_name,true,'الرقم المرجعي',reference,false],
      ['الفريق',m.teams.join('، ')||'غير محدد',true,'نوع التقرير',reportType,true],
      ['فترة التقييم',`${fmtRange(m.start)} - ${fmtRange(m.end)}`,false,'تاريخ الإصدار',fmtDate(new Date()),false],
      ['حالة التقرير',m.provisional?'مؤشر أولي للمراجعة':'معتمد آليًا للمراجعة',true,'مصدر البيانات','Meeting 967',false],
    ]));

    children.push(new Paragraph({spacing:{after:80},children:[]}));
    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      columnWidths:[3100,3100,3100],
      borders:noBorders,
      rows:[new TableRow({cantSplit:true,children:[
        cell(`التقييم النهائي\n${m.score===null?'—':`${m.score} من 100`}`,{fill:GOLD,bold:true,color:WHITE,rtl:true,center:true,size:20}),
        cell(`التصنيف\n${m.label}`,{fill:BLACK,bold:true,color:WHITE,rtl:true,center:true,size:19}),
        cell(`حالة المؤشر\n${indicatorState}`,{fill:scoreFill(m.score),bold:true,rtl:true,center:true,size:18}),
      ]})],
    }));

    children.push(new Paragraph({spacing:{after:75},children:[]}));
    children.push(sectionBar('الملخص التنفيذي'));
    const summary=m.score===null
      ?'لا تتوفر بيانات كافية خلال هذه الفترة لإصدار مؤشر رقمي. يعرض التقرير السجلات المتاحة للمراجعة والمتابعة.'
      :`خلال فترة التقييم حافظ العضو على متوسط حضور ${pct(m.attendance.avg_presence)}، وسُندت إليه ${m.tasks.assigned} مهمة، واعتمد منها ${m.tasks.approved}. يوجد ${m.tasks.submitted} قيد المراجعة و${m.tasks.overdue} متأخرة، وسُجل ${m.attendance.late} تأخر و${m.attendance.absent} غياب.`;
    children.push(rtlP(summary,{size:18,before:60,after:70}));

    children.push(new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      columnWidths:[2325,2325,2325,2325],
      borders:thinBorders,
      rows:[
        new TableRow({cantSplit:true,children:[
          labelCell(`الاجتماعات المتوقعة\n${m.attendance.meetings}`),
          labelCell(`متوسط الحضور\n${pct(m.attendance.avg_presence)}`),
          labelCell(`المهام المسندة\n${m.tasks.assigned}`),
          labelCell(`المهام المعتمدة\n${m.tasks.approved}`),
        ]}),
        new TableRow({cantSplit:true,children:[
          cell(`التأخر\n${m.attendance.late}`,{rtl:true}),
          cell(`الغياب\n${m.attendance.absent}`,{rtl:true}),
          cell(`قيد المراجعة\n${m.tasks.submitted}`,{rtl:true}),
          cell(`المهام المتأخرة\n${m.tasks.overdue}`,{rtl:true}),
        ]}),
      ],
    }));

    children.push(new Paragraph({spacing:{after:75},children:[]}));
    children.push(sectionBar('سجل الاجتماعات والحضور'));
    const attendanceRows=[new TableRow({tableHeader:true,cantSplit:true,children:[
      blackCell('#',false),blackCell('التاريخ'),blackCell('الاجتماع'),blackCell('الحالة'),blackCell('نسبة الحضور'),blackCell('الوصول'),
    ]})];
    for(const [index,row] of m.attendanceRows.entries())attendanceRows.push(new TableRow({cantSplit:true,children:[
      cell(index+1,{rtl:false,center:true}),
      cell(fmtDate(row.ended_at||row.scheduled_at),{rtl:false,center:true}),
      cell(row.name||'اجتماع',{rtl:true,bold:true}),
      cell(attendanceStatusArabic(row.status),{rtl:true,center:true,fill:row.status==='absent'?RED:row.status==='excused'?AMBER:GREEN}),
      cell(row.status==='excused'?'—':pct(Number(row.presence_ratio||0)*100),{rtl:false,center:true}),
      cell(arrivalArabic(row.status),{rtl:true,center:true}),
    ]}));
    if(!m.attendanceRows.length)attendanceRows.push(new TableRow({children:[cell('لا توجد اجتماعات مسجلة خلال الفترة.',{rtl:true,center:true})]}));
    children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:[650,1450,2600,1350,1550,1700],borders:thinBorders,rows:attendanceRows}));

    children.push(new Paragraph({spacing:{after:75},children:[]}));
    children.push(sectionBar('سجل المهام والإنجاز'));
    const taskRows=[new TableRow({tableHeader:true,cantSplit:true,children:[
      blackCell('المهمة'),blackCell('الحالة'),blackCell('الموعد'),blackCell('التسليم'),blackCell('قرار المراجع'),
    ]})];
    for(const row of m.taskRows)taskRows.push(new TableRow({cantSplit:true,children:[
      cell(row.title,{rtl:true,bold:true}),
      cell(taskStatusArabic(row),{rtl:true,center:true,fill:taskFill(row)}),
      cell(fmtDate(row.due_at),{rtl:false,center:true}),
      cell(deliveryLabel(row),{rtl:hasArabic(deliveryLabel(row)),center:true}),
      cell(reviewDecision(row),{rtl:true,center:true}),
    ]}));
    if(!m.taskRows.length)taskRows.push(new TableRow({children:[cell('لا توجد مهام مسندة خلال الفترة.',{rtl:true,center:true})]}));
    children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:[2700,1750,1250,1600,2000],borders:thinBorders,rows:taskRows}));

    children.push(new Paragraph({spacing:{after:75},children:[]}));
    children.push(sectionBar('منهجية التقييم والملاحظات'));
    children.push(rtlP('طريقة الحساب: الحضور الفعلي 45%، إنجاز المهام بعد اعتماد المراجع 45%، والالتزام بوقت الاجتماعات 10%. إذا لم تتوفر إحدى فئات البيانات يعاد توزيع الوزن على البيانات المتاحة فقط.',{size:16,color:GRAY,before:55,after:35}));
    children.push(rtlP(m.provisional?'حجم البيانات خلال هذه الفترة قليل؛ لذلك النتيجة مؤشر أولي للمراجعة وليست حكمًا نهائيًا على العضو.':'يعتمد التقرير على السجلات الفعلية داخل Meeting 967، ولا تعتبر المهمة مكتملة في التقييم إلا بعد اعتماد المراجع.',{size:16,color:GRAY}));

    const footerTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:[3100,3100,3100],borders:noBorders,rows:[new TableRow({children:[
      ltrCell('967 Community Movement',{color:GRAY,size:12,alignment:AlignmentType.LEFT}),
      ltrCell('Meeting 967',{color:GRAY,size:12,alignment:AlignmentType.CENTER}),
      cell('سري داخليًا - تقرير دوري',{color:GRAY,size:12,rtl:true,alignment:AlignmentType.RIGHT}),
    ]})]});

    const doc=new Document({
      creator:'Meeting 967',title:`${title} - ${m.user.display_name}`,description:'Official periodic member performance report',
      styles:{default:{document:{run:{font:FONT,size:20,color:BLACK},paragraph:{spacing:{line:260}}}}},
      sections:[{properties:{page:{margin:{top:420,right:500,bottom:500,left:500}}},footers:{default:new Footer({children:[footerTable]})},children}],
    });
    const buffer=await Packer.toBuffer(doc);
    const dir=path.resolve(this.env.STORAGE_DIR||'storage','performance-reports',String(guildId),String(userId));
    await fs.mkdir(dir,{recursive:true});
    const safePeriod=period==='month'?'شهري':'أسبوعي';
    const filename=safeFilePart(`${safePeriod} - ${m.user.display_name} - ${issue.toFormat('yyyy-MM-dd')}`)+'.docx';
    const file=path.join(dir,filename);
    await fs.writeFile(file,buffer);
    const storedMetrics={user:m.user,teams:m.teams,period:m.period,start:m.start,end:m.end,attendance:m.attendance,tasks:m.tasks,score:m.score,label:m.label,evidence:m.evidence,provisional:m.provisional,reference,filename,template:'performance-967-v5-unified-clean'};
    await this.db.query(`
      INSERT INTO member_performance_reports
        (id,guild_id,user_id,period_type,range_start,range_end,generated_by,file_path,score,metrics)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [reportId,guildId,userId,period,m.start,m.end,actorId,file,m.score,JSON.stringify(storedMetrics)],
    );
    await this.audit?.log?.({guildId,actorId,action:'performance.generate',targetType:'user',targetId:String(userId),newValue:{period,score:m.score,rangeStart:m.start,rangeEnd:m.end,reference,filename}}).catch(()=>{});
    return {file,metrics:m,reference};
  }
}
