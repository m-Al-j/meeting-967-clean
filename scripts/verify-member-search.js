import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pickerMenuPage,PICKER_SEARCH_VALUE} from '../src/interfaces/discord/guildPicker.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const fail=(msg)=>{console.error(`❌ ${msg}`);process.exit(1);};

const sample=Array.from({length:60},(_,i)=>({label:`Member ${i+1}`,description:`@user${i+1}`,value:String(i+1)}));
for(const page of [0,1,2]){
  const p=pickerMenuPage(sample,page);
  if(!p.menuItems.length)fail(`صفحة ${page+1} بلا خيارات`);
  if(p.menuItems[0].value!==PICKER_SEARCH_VALUE)fail(`البحث ليس أول خيار في صفحة ${page+1}`);
  if(!String(p.menuItems[0].label).includes('بحث'))fail(`عنوان البحث غير موجود في صفحة ${page+1}`);
  if(p.menuItems.length>25)fail(`صفحة ${page+1} تتجاوز حد Discord`);
}

const modules=[
  'src/interfaces/discord/interactions/permissions.js',
  'src/interfaces/discord/interactions/teams.js',
  'src/interfaces/discord/interactions/tasks.js',
  'src/interfaces/discord/interactions/attendance.js'
];
for(const rel of modules){
  const text=fs.readFileSync(path.join(root,rel),'utf8');
  for(const token of ['pickerMenuPage','pickerSearchValue','memberSearchModal','memberSearchRows']){
    if(!text.includes(token))fail(`${rel} لا يحتوي ${token}`);
  }
}

const memberSearch=fs.readFileSync(path.join(root,'src/interfaces/discord/memberSearch.js'),'utf8');
if(!memberSearch.includes('بحث بالاسم أو اليوزر'))fail('زر البحث الظاهر غير موجود');

console.log('✅ Member Search verified: زر ظاهر + أول خيار داخل القائمة + بحث بالاسم/اليوزر + صفحات Discord.');
