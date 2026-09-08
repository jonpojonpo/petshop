#!/usr/bin/env node
// A disposable app-server policy/telemetry shim beneath the upstream ACP bridge.
// No inference, tool execution, tool loop, model catalogue, or rendering lives here.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const binary=fileURLToPath(new URL('../node_modules/@openai/codex/bin/codex.js',import.meta.url));
const child=spawn(process.execPath,[binary,...process.argv.slice(2)],{stdio:['pipe','pipe','inherit']});
const leash=process.env.PETSHOP_LEASH || 'read-only';
const approval=process.env.PETSHOP_APPROVAL || 'on-request';
const policy=leash==='danger-full-access'?{type:'dangerFullAccess'}:leash==='read-only'?{type:'readOnly',networkAccess:false}:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false};
createInterface({input:process.stdin}).on('line',line=>{
  let m;try{m=JSON.parse(line);}catch{child.stdin.write(line+'\n');return;}
  if(['thread/start','thread/resume','thread/fork','turn/start'].includes(m.method)){
    m.params ||= {};
    if(m.method==='turn/start')m.params.sandboxPolicy=policy;
    else m.params.sandbox=leash;
    m.params.approvalPolicy=approval;m.params.approvalsReviewer='user';
    if(process.env.PETSHOP_MODEL)m.params.model=process.env.PETSHOP_MODEL;
  }
  child.stdin.write(JSON.stringify(m)+'\n');
}).on('close',()=>child.stdin.end());
createInterface({input:child.stdout}).on('line',line=>{
  try {
    const m=JSON.parse(line);
    if(process.env.PETSHOP_TELEMETRY && ['thread/tokenUsage/updated','account/rateLimits/updated','turn/completed'].includes(m.method))
      appendFileSync(process.env.PETSHOP_TELEMETRY,JSON.stringify({ts:new Date().toISOString(),...m})+'\n',{mode:0o600});
  }catch{}
  process.stdout.write(line+'\n');
});
child.on('error',e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code || 0;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
