import fs from 'node:fs';
const checks={
  'src/infrastructure/discord/commandDefinitions.js':["setName('panel')"],
  'src/interfaces/discord/memberSearch.js':['بحث'],
  'src/interfaces/discord/smartMemberSearch.js':['rankMemberOptionsForPicker','حسب الاسم فقط'],
  'src/interfaces/discord/smartMemberRanking.js':['Ranking is based ONLY on the typed name/username'],
  'src/interfaces/discord/interactions/permissions.js':['rankMemberOptionsForPicker'],
  'src/interfaces/discord/interactions/teams.js':['rankMemberOptionsForPicker'],
  'src/interfaces/discord/interactions/tasks.js':['rankMemberOptionsForPicker'],
  'src/interfaces/discord/interactions/attendance.js':['rankMemberOptionsForPicker']
};
for(const [file,needles] of Object.entries(checks)){const text=fs.readFileSync(file,'utf8');for(const needle of needles)if(!text.includes(needle))throw new Error(`${file}: missing ${needle}`);}
const app=fs.readFileSync('src/app.js','utf8');
if(app.includes('MemberPickerUsageRepository')||app.includes('memberPickerUsage'))throw new Error('Member history must not affect suggestions.');
const router=fs.readFileSync('src/interfaces/discord/router.js','utf8');
if(router.includes('recordSelection'))throw new Error('Previous selections must not be tracked for ranking.');
const commands=fs.readFileSync('src/infrastructure/discord/commandDefinitions.js','utf8');
if(commands.includes("setName('member')"))throw new Error('The /member command must not be registered.');
console.log('✅ Member suggestions are based only on name/username; no /member and no usage history');
