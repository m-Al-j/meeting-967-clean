import fs from 'node:fs/promises';
import { AIAssistantService } from '../src/application/services/AIAssistantService.js';

const data=JSON.parse(await fs.readFile('knowledge/ai/intents.json','utf8'));
const ai=new AIAssistantService({db:null,env:{},logger:null,permissionService:null});
ai.training=data;
let failed=0;

const cases=[["كيف اكلف شخص بمهمة", "task_create_assign"], ["كيف اكلف واحد بمهمه", "task_create_assign"], ["كيف اقدم اعتذار", "excuse_submit"], ["كيف انسحب من العضوية", "membership_withdraw"], ["كيف اجمد عضويتي", "membership_freeze"], ["متى اقدر ارجع", "membership_reactivation"], ["وش اجتماعي الجاي", "next_meeting"], ["وش اجتماعاتي الجاية", "upcoming_meetings"], ["كم اجتماع حضرت", "attendance"], ["وش علي من مهام", "tasks"], ["كم نقطة عندي", "points"], ["وش رتبتي", "rank"], ["وش صلاحياتي", "permissions"], ["كيف امنح صلاحية", "permissions_manage"], ["كيف اشوف التسجيلات", "recordings"], ["كيف اطلع تقرير", "reports"], ["كيف اطلب مساعدة", "support"], ["كيف افتح محادثة خاصة", "private_chat"], ["كيف اسوي اجتماع", "meeting_create"], ["كيف اعدل اجتماع", "meeting_edit"], ["كيف اعيد جدولة الاجتماع", "meeting_reschedule"], ["كيف اكمل المهمة واسلمها للمراجعة", "task_submit"], ["كيف اراجع مهمة", "task_review"], ["كيف استخدم التست لاب", "test_lab"], ["كيف اسوي نسخة احتياطية", "backups"]];
for(const [q,expected] of cases){
  const got=ai.classify(q).intent;
  const ok=got===expected;
  console.log(`${ok?'✅':'❌'} ${q} -> ${got}`);
  if(!ok)failed++;
}

for(const entry of data){
  const sample=entry.phrases[0];
  if(!sample)continue;
  const got=ai.classify(sample).intent;
  if(got!==entry.intent){
    console.log(`❌ training collision: ${entry.intent} :: ${sample} -> ${got}`);
    failed++;
  }
}

if(failed)process.exit(1);
console.log('✅ Local AI Coach v1.2.0 self-test passed');
