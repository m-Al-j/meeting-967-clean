export class GroqAIProvider {
  constructor({apiKey,model='openai/gpt-oss-20b',logger=null}={}) {
    this.apiKey=String(apiKey??'').trim();
    this.modelName=String(model||'openai/gpt-oss-20b').trim();
    this.logger=logger;
  }

  enabled(){ return Boolean(this.apiKey); }

  _schema(value){
    if(Array.isArray(value)) return value.map(x=>this._schema(x));
    if(!value || typeof value!=='object') return value;
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(k==='type' && typeof v==='string') out[k]=v.toLowerCase();
      else if(k==='properties' && v && typeof v==='object'){
        out[k]=Object.fromEntries(Object.entries(v).map(([pk,pv])=>[pk,this._schema(pv)]));
      }else out[k]=this._schema(v);
    }
    return out;
  }

  tools(declarations=[]){
    return declarations.map(d=>({
      type:'function',
      function:{
        name:String(d.name),
        description:String(d.description??''),
        parameters:this._schema(d.parameters??{type:'object',properties:{},required:[]}),
      },
    }));
  }

  async chat({messages,tools=[]}={}){
    if(!this.enabled()) throw new Error('GROQ_API_KEY غير موجود');

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),35_000);
    try{
      const body={
        model:this.modelName,
        messages,
        temperature:0.2,
        max_completion_tokens:4096,
        reasoning_effort:'medium',
        include_reasoning:false,
        parallel_tool_calls:false,
      };
      if(tools?.length) body.tools=this.tools(tools);

      const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{
          'Authorization':`Bearer ${this.apiKey}`,
          'Content-Type':'application/json',
        },
        body:JSON.stringify(body),
        signal:controller.signal,
      });

      const raw=await res.text();
      let data=null;
      try{ data=JSON.parse(raw); }catch{}

      if(!res.ok){
        const err=String(data?.error?.message??raw??`HTTP ${res.status}`).slice(0,600);
        const e=new Error(`Groq HTTP ${res.status}: ${err}`);
        e.status=res.status;
        throw e;
      }

      return data;
    }finally{
      clearTimeout(timer);
    }
  }
}
