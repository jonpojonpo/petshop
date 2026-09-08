import { useEffect, useState } from 'react';
import type { Body } from '../server/types.ts';
export default function Sprite({body,size=112,state='idle',className=''}:{body?:Body;size?:number;state?:string;className?:string}){
  const [frame,setFrame]=useState(0);const [hover,setHover]=useState(false);
  const rows:Record<string,number>={idle:0,walking:1,thinking:8,working:7,waiting:6,failed:5,completed:3};
  const row=hover?3:(rows[state]??0);const count=body?.frames[row]||1;
  useEffect(()=>{setFrame(0);if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const timer=setInterval(()=>setFrame(f=>(f+1)%count),state==='walking'?105:180);return()=>clearInterval(timer);},[count,state,row]);
  const scale=size/192;
  if(!body)return <div className={`sprite no-body ${className}`} style={{width:size,height:size*208/192}}>?</div>;
  return <div role="img" aria-label={`${body.name}, ${hover?'waving':state}`} className={`sprite ${className}`} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{width:size,height:size*208/192,backgroundImage:`url(${body.url})`,backgroundSize:`${1536*scale}px ${2288*scale}px`,backgroundPosition:`${-Math.min(frame,count-1)*size}px ${-row*208*scale}px`}} />;
}
