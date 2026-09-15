import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square, Wrench, Download, MessageCircle } from "lucide-react";
import type { Pet, Body } from "../server/types.ts";
import Sprite from "./Sprite.tsx";
import { api as request } from "./api.ts";

const busy = (s?: string) => ["queued", "running", "waiting-permission"].includes(s || "");
export default function ChatView({ pets, bodies, initialPet }: { pets: Pet[]; bodies: Body[]; initialPet: string }) {
  const [petId, setPetId] = useState(initialPet || pets.find(p=>p.name==="Juno")?.id || pets[0]?.id || "");
  const [id, setId] = useState<string | null>(()=>localStorage.getItem("petshop-chat"));
  const [chat, setChat] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [paid, setPaid] = useState(false);
  const [remoteWrite, setRemoteWrite] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const selected = useRef(id); selected.current = id;
  const follow = useRef(true);
  const pet = pets.find(p=>p.id === (chat?.petId || petId));
  const loading = !!id && !chat;
  const active = sending || busy(chat?.status);
  const sendingRef = useRef(false);
  useEffect(()=> { if(initialPet) {setPetId(initialPet);choose(null);} },[initialPet]);
  useEffect(()=> {
    let stopped=false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const list=await request('/api/chats'); if(stopped)return; setChats(list.chats);
        if(id && !list.chats.some((c: any)=>c.id===id)) { choose(null); return; }
        if(id) {
          const d=await request(`/api/chats/${id}`); if(stopped || selected.current!==id)return;
          setChat(d.chat);setPending(d.pending);setFiles(d.files || []);setNotes(d.notes || "");setPetId(d.chat.petId);
        }
      } catch(e) { if(!stopped)setError((e as Error).message); }
      if(!stopped)timer=setTimeout(poll,1500);
    }
    void poll(); return ()=>{stopped=true;clearTimeout(timer);};
  },[id]);
  useEffect(()=>{ if(follow.current && chat?.messages?.length)end.current?.scrollIntoView({block:"nearest",behavior:"smooth"}); },[chat?.messages?.at(-1)?.text,chat?.status]);
  function choose(next: string|null) {selected.current=next;setPaid(false);setRemoteWrite(false);setId(next);setChat(null);setPending([]);setFiles([]);setNotes("");setError("");follow.current=true;if(next)localStorage.setItem('petshop-chat',next);else localStorage.removeItem('petshop-chat');}
  async function send() {
    if(!text.trim() || active || loading || !pet || sendingRef.current)return; sendingRef.current=true;setSending(true);setError("");follow.current=true;
    try {
      let next=id;
      if(!next) {const created=await request('/api/chats',{petId}); next=created.id;choose(next);}
      const updated=await request(`/api/chats/${next}/messages`,{text,apiApproved:paid,remoteWriteApproved:remoteWrite});
      if(selected.current===next) {setChat(updated);setText("");setPaid(false);setRemoteWrite(false);}
    } catch(e){setError((e as Error).message);} finally {sendingRef.current=false;setSending(false);}
  }
  const toolMap = new Map<string,any>();
  for(const e of chat?.events || []) if(e.type==='acp' && ['tool_call','tool_call_update'].includes(e.data.sessionUpdate)) {
    const k=e.data.toolCallId || String(e.seq);toolMap.set(k,{...toolMap.get(k),...e.data});
  }
  const lastTool = [...toolMap.values()].at(-1);
  const toolName = lastTool?.rawInput?.tool || lastTool?.title || '';
  const exploring = active && /web_search/.test(toolName);
  const reading = active && /read_page/.test(toolName);
  const remembering = active && /memory/.test(toolName);
  const activity = loading ? 'Loading conversation…' : sending ? 'Sending…' : !active ? 'Ready to chat' : chat?.status === 'queued' ? 'Waiting for the GPU…' : chat?.status === 'waiting-permission' ? 'Waiting for your nod' : exploring ? 'Sniffing out sources…' : reading ? 'Nose in an article…' : remembering ? 'Tucking a note away…' : 'Turning it over…';
  function linked(value: string) { return value.split(/(https?:\/\/[^\s<>"\)\]]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>:part); }
  return <div className="chat-workspace">
    <div className="chat-heading"><div><h1>Chat with your pet.</h1></div><button className="secondary compact" disabled={sending} onClick={()=>choose(null)}><Plus size={16}/> New chat</button></div>
    <div className="chat-pet-picker" aria-label="Choose a companion">{pets.map(p=><button key={p.id} disabled={sending} aria-pressed={pet?.id===p.id} className={pet?.id===p.id?'chosen':''} onClick={()=>{setPetId(p.id);choose(null);setPaid(false);setRemoteWrite(false);}}><img src={`/api/bodies/${p.petshop.body}/portrait`} alt=""/><span>{p.name}<small>{p.petshop.billing==='local'?'Local':p.model}</small></span></button>)}</div>
    <div className="chat-topline">
      <label className="chat-history-label"><span>Conversation</span><select disabled={sending} aria-label="Conversation" value={id || ''} onChange={e=>choose(e.target.value || null)}><option value="">New conversation</option>{chats.map(c=><option value={c.id} key={c.id}>{pets.find(p=>p.id===c.petId)?.name || 'Pet'} · {c.title}</option>)}</select></label>
    </div>
    <div className="pet-presence"><Sprite body={bodies.find(b=>b.id===pet?.petshop.body)} size={72} state={active ? exploring?'walking':reading?'working':'thinking':'idle'}/><div><strong>{pet?.name || 'Your pet'} · {activity}</strong><small>{pet?.petshop.loadouts?.includes('browsing') ? '🧰 Browsing · articles · shared pet memories' : pet?.description}</small></div></div>
    {notes && <details className="pet-notes"><summary>📓 {pet?.name}’s notebook</summary><p>{notes}</p><small>Shared across this pet’s conversations. Ask your pet to update or forget a note.</small></details>}
    <div className="chat-transcript" onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<120;}} aria-live="polite" aria-label="Messages">
      {!loading && !chat?.messages?.length && <div className="chat-welcome"><h2>What shall we do, JP?</h2><p>Bring me a curiosity. Let’s see what we can dig up.</p><p className="chat-workspace-hint">{pet?.petshop.loadouts?.includes('browsing') ? 'Your pet keeps its notes between conversations.' : 'Each conversation has a workspace for files.'}</p><div className="chat-starters">{["Find and summarise today’s AI news, with sources.",'Research a curious fact about southern France.'].map(s=><button key={s} onClick={()=>setText(s)}>{s}</button>)}</div></div>}
      {chat?.messages?.filter((m:any)=>m.text).map((m:any)=><article key={m.id} className={`chat-message ${m.role}`}><strong>{m.role==='user'?'You':pet?.name}</strong><div>{linked(m.text)}</div></article>)}
      {loading && <p role="status">Loading conversation…</p>}
      {toolMap.size>0 && <details className="chat-tools"><summary><Wrench size={14}/> Work log · {toolMap.size} tool calls</summary>{[...toolMap].map(([key,t])=><details key={key}><summary>{t.title || t.kind || 'Tool'} · {t.status || 'started'}</summary><pre>{JSON.stringify(t.rawOutput || t.content || t.rawInput || {},null,2)}</pre></details>)}</details>}
      {files.length>0 && <div className="chat-files">{files.map(file=><a key={file} href={`/api/chats/${id}/file?path=${encodeURIComponent(file)}`} download><Download size={15}/>{file}</a>)}</div>}
      {pending.map(d=><div className="decision" key={d.id}><h3>{d.title || 'Your pet needs permission'}</h3><div className="button-row">{d.options.map((o:any)=><button className="secondary" key={o.optionId} onClick={()=>void request(`/api/chat-decisions/${d.id}`,{option:o.optionId}).then(()=>setPending(p=>p.filter(x=>x.id!==d.id))).catch(e=>setError(e.message))}>{o.name || o.optionId}</button>)}</div></div>)}
      {chat?.error && <p className="form-error">{chat.error}</p>}
      <div ref={end}/>
    </div>
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}}>
      {error && <p role="alert" className="form-error">{error}</p>}
      {pet?.petshop.billing==='api' && <label><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/> Allow paid API use for this message</label>}
      {pet?.petshop.provider==='openrouter' && pet.sandbox_mode!=='read-only' && <label><input type="checkbox" checked={remoteWrite} onChange={e=>setRemoteWrite(e.target.checked)}/> Allow this remote provider to receive data and write files for this message</label>}
      <div className="chat-input-row"><textarea disabled={sending || loading} aria-label="Message your pet" placeholder={`Message ${pet?.name || 'your pet'}…`} rows={2} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 651px)').matches){e.preventDefault();void send();}}}/>
        {active?<button type="button" className="secondary" aria-label="Stop reply" disabled={sending || !id} onClick={()=>void request(`/api/chats/${id}/cancel`,{}).catch(e=>setError(e.message))}><Square size={19}/></button>:<button className="primary" aria-label="Send message" disabled={!text.trim() || !pet || loading}><ArrowUp size={22}/></button>}</div>
      <small><MessageCircle size={12}/> Just ask. Your pet will use its tools when needed.</small>
    </form>
  </div>;
}
