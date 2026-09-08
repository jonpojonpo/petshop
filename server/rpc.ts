import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/** JSON-RPC transport only. The borrowed harness owns every model/tool iteration. */
export class RpcProcess {
  child: ChildProcessWithoutNullStreams;
  pending = new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  next=1; stderr=''; closed=false;
  onNotification:(method:string,params:any)=>void = ()=>{};
  onRequest:(method:string,params:any)=>Promise<any> = async(method)=>{throw new Error(`Unsupported client method: ${method}`);};
  constructor(command:string,args:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv}={}) {
    this.child=spawn(command,args,{...options,stdio:'pipe',detached:true});
    this.child.stderr.on('data',d=>{this.stderr=(this.stderr+d.toString()).slice(-6000);});
    const lines=createInterface({input:this.child.stdout});
    lines.on('line',line=>{
      let message:any; try{message=JSON.parse(line);}catch{return;}
      if(message.method && message.id!=null) {
        void this.onRequest(message.method,message.params).then(result=>this.send({jsonrpc:'2.0',id:message.id,result}),e=>this.send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:e.message}}));
      } else if(message.method) this.onNotification(message.method,message.params);
      else {
        const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);
        message.error ? p.reject(new Error(message.error.message || JSON.stringify(message.error))) : p.resolve(message.result);
      }
    });
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',(code,signal)=>this.fail(new Error(`Harness exited (${signal || code}). ${this.stderr.slice(-2000)}`)));
  }
  private fail(e:Error){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
  send(message:any){if(!this.closed && this.child.stdin.writable)this.child.stdin.write(JSON.stringify(message)+'\n');}
  notify(method:string,params:any){this.send({jsonrpc:'2.0',method,params});}
  request(method:string,params:any={},timeout=60_000):Promise<any>{
    if(this.closed)return Promise.reject(new Error('Harness is closed.'));
    const id=this.next++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timed out.`));},timeout);this.pending.set(id,{resolve,reject,timer});this.send({jsonrpc:'2.0',id,method,params});});
  }
  close(){
    this.child.stdin.end();
    if(this.child.pid){try{process.kill(-this.child.pid,'SIGTERM');}catch{}}
    const child=this.child;const t=setTimeout(()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}},2000);t.unref();
    this.fail(new Error('Harness closed.'));
  }
}
