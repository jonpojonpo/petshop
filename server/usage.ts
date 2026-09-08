import path from 'node:path';
import { RpcProcess } from './rpc.ts';
import { cleanEnvironment, createHarness } from './harness.ts';
import { normalize, fingerprint } from './sheets.ts';
import { ROOT, CODEX_HOME } from './paths.ts';
let cached:any=null;let pending:Promise<any>|null=null;
export async function accountUsage(){
  if(cached && Date.now()-cached.fetchedMs<180_000)return cached;
  if(pending)return pending;
  pending=(async()=>{
    const [codex,claude]=await Promise.allSettled([codexUsage(),claudeUsage()]);
    const unwrap=(r:PromiseSettledResult<any>)=>r.status==='fulfilled'?r.value:{available:false,error:r.reason.message};
    cached={fetchedAt:new Date().toISOString(),fetchedMs:Date.now(),codex:unwrap(codex),claude:unwrap(claude)};return cached;
  })().finally(()=>pending=null);return pending;
}
async function codexUsage(){
  const env=cleanEnvironment('subscription');env.CODEX_HOME=CODEX_HOME;
  const rpc=new RpcProcess(process.execPath,[path.join(ROOT,'node_modules/@openai/codex/bin/codex.js'),'app-server'],{cwd:ROOT,env});
  try {
    await rpc.request('initialize',{clientInfo:{name:'petshop-usage',version:'0.1.0'}},20_000);rpc.notify('initialized',{});
    const account=await rpc.request('account/read',{refreshToken:false},15_000);
    if(account.account?.type!=='chatgpt')return {available:false,error:'No ChatGPT subscription login detected.'};
    const limits=await rpc.request('account/rateLimits/read',{},20_000);
    const source=limits.rateLimitsByLimitId?Object.values(limits.rateLimitsByLimitId):[limits.rateLimits];
    const windows=source.filter(Boolean).flatMap((x:any)=>[x.primary,x.secondary].filter(Boolean).map((w:any)=>({name:`${x.limitName || x.limitId || 'Codex'} · ${w.windowDurationMins===300?'5 hours':w.windowDurationMins===10080?'7 days':`${w.windowDurationMins || '?'} min`}`,usedPercent:w.usedPercent,resetsAt:w.resetsAt?new Date(w.resetsAt*1000).toISOString():null})));
    return {available:true,plan:account.account.planType,windows,source:'Codex app-server'};
  }finally{rpc.close();}
}
export function parseClaudeUsage(text:string){
  return [...text.matchAll(/\*\*([^\n*]+)\*\*\s*[—–-]\s*\*\*([\d.]+)%\*\*\s*·\s*Resets ([^\n]+)/g)].map(m=>{
    const date=m[3].replace(/^([^,]+),\s*/,`$1 ${new Date().getFullYear()}, `);const parsed=new Date(date);
    return {name:m[1],usedPercent:Number(m[2]),resetsAt:Number.isNaN(parsed.getTime())?null:parsed.toISOString(),resetsLabel:m[3]};
  });
}
async function claudeUsage(){
  // The pinned adapter handles /usage locally. It refreshes OAuth itself and
  // returns account telemetry without model inference or a private-API client.
  const sheet=normalize({name:'Usage',description:'Account telemetry',model:'opus',sandbox_mode:'read-only',petshop:{harness:'claude',billing:'subscription'}});
  const pet={...sheet,id:'usage',source:'',fingerprint:fingerprint(sheet),xp:0,tokens:0,observedTps:null};
  const h=await createHarness(pet,ROOT,'account-usage');let text='';
  try{
    h.rpc.onNotification=(method,p)=>{if(method==='session/update'&&p.update.sessionUpdate==='agent_message_chunk')text+=p.update.content?.text||'';};
    await h.rpc.request('initialize',{protocolVersion:1,clientInfo:{name:'petshop-usage',version:'0.1.0'},clientCapabilities:{}},20_000);
    const session=await h.rpc.request('session/new',{cwd:ROOT,mcpServers:[],_meta:h.sessionMeta},20_000);
    await h.rpc.request('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'/usage'}]},30_000);
    const windows=parseClaudeUsage(text);
    return {available:windows.length>0,windows,raw:text,error:windows.length?undefined:'Claude did not report usage windows. Open /usage in Claude Code.',source:'Claude Code /usage (no model inference)'};
  }finally{h.rpc.close();}
}
