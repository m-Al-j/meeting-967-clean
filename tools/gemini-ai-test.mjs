import fs from 'node:fs/promises';
const env=await fs.readFile('.env','utf8').catch(()=> '');
const key=(env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]??'').trim();
const model=(env.match(/^GEMINI_MODEL=(.*)$/m)?.[1]??'gemini-3.5-flash').trim();
console.log(`🔎 Gemini model: ${model}`);
if(!key || key==='PUT_YOUR_GEMINI_API_KEY_HERE'){
  console.log('⚠️ لم يتم وضع مفتاح Gemini بعد. ثبّت المفتاح في .env ثم شغّل هذا الاختبار مرة أخرى.');
  process.exit(0);
}
const {GoogleGenAI}=await import('@google/genai');
const ai=new GoogleGenAI({apiKey:key});
const response=await ai.models.generateContent({
  model,
  contents:'رد بكلمة واحدة فقط: جاهز',
  config:{temperature:0,maxOutputTokens:16},
});
console.log(`✅ Gemini API responded: ${String(response.text??'').trim()}`);
