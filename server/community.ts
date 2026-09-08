import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';
import { CODEX_HOME, STATE, assertId } from './paths.ts';
import { atlasFrames, getBodies, scanBodies } from './bodies.ts';
const ORIGIN='https://codex-pets.net';
const MAX_BYTES=32*1024*1024;
export function communityUrl(input:string){const u=new URL(input,ORIGIN);if(u.origin!==ORIGIN||u.username||u.password)throw new Error('Community assets must come from codex-pets.net.');return u;}
async function download(url:string,limit=MAX_BYTES){
  let target=communityUrl(url);
  for(let redirect=0;redirect<4;redirect++){
    const r=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json, application/zip, image/webp'}});
    if(r.status>=300&&r.status<400){target=communityUrl(new URL(r.headers.get('location')||'',target).href);continue;}
    if(!r.ok)throw new Error(`Community catalog returned HTTP ${r.status}. Check the slug or try again later.`);
    if(Number(r.headers.get('content-length'))>limit)throw new Error('Community file exceeds the size limit.');
    const reader=r.body?.getReader();if(!reader)throw new Error('Community response is empty.');const parts:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Community file exceeds the size limit.');}parts.push(value);}
    return Buffer.concat(parts);
  }throw new Error('Too many community redirects.');
}
const json=async(url:string)=>JSON.parse((await download(url,4*1024*1024)).toString('utf8'));
export async function searchCommunity(query='',page=1){const u=new URL('/api/pets',ORIGIN);u.searchParams.set('q',query.slice(0,120));u.searchParams.set('page',String(Math.max(1,Math.min(page,1000))));u.searchParams.set('pageSize','12');const d=await json(u.href);if(!Array.isArray(d.pets))throw new Error('Unexpected community catalog format.');return {pets:d.pets.map(summary),page:d.page,totalPages:d.totalPages,total:d.total};}
function summary(p:any){assertId(p.id);return {id:p.id,name:String(p.displayName||p.id),description:String(p.description||''),creator:String(p.ownerHandle||p.ownerName||'Unknown creator'),version:p.spriteVersionNumber,url:`${ORIGIN}/pets/${encodeURIComponent(p.id)}`,poster:`/api/community/${encodeURIComponent(p.id)}/poster`,installed:getBodies().some(b=>b.id===p.id)};}
export async function communityPet(slug:string){assertId(slug);const d=await json(`/api/pets/${encodeURIComponent(slug)}/share-data`);if(d.pet?.id!==slug)throw new Error('Community manifest ID does not match the requested pet.');return d.pet;}
export async function previewCommunity(slug:string){return summary(await communityPet(slug));}
export async function communityPoster(slug:string){const p=await communityPet(slug);return download(p.posterUrl||`/api/pets/${slug}/preview`,8*1024*1024);}
export async function communityCollection(slug:string){assertId(slug);const d=await json(`/api/collections/${encodeURIComponent(slug)}`);if(!Array.isArray(d.pets))throw new Error('Unexpected collection format.');return {slug,name:d.collection?.displayName||slug,pets:d.pets.map(summary)};}
export function unpackBody(bytes:Uint8Array,slug:string){
  let total=0;
  const entries=unzipSync(bytes,{filter:f=>{total+=f.originalSize;if(total>MAX_BYTES)throw new Error('Unpacked community body exceeds the size limit.');if(f.name==='pet.json'&&f.originalSize>64000)throw new Error('Manifest is too large.');return ['pet.json','spritesheet.webp'].includes(f.name);}});
  if(!entries['pet.json']||!entries['spritesheet.webp'])throw new Error('Body ZIP must contain pet.json and spritesheet.webp at its root.');
  const manifest=JSON.parse(Buffer.from(entries['pet.json']).toString('utf8'));
  if(manifest.id!==slug||manifest.spriteVersionNumber!==2||manifest.spritesheetPath!=='spritesheet.webp'||typeof manifest.displayName!=='string')throw new Error('Downloaded pet manifest failed validation.');
  return {manifest,atlas:entries['spritesheet.webp']};
}
export async function adoptCommunity(slug:string){
  assertId(slug);const destination=path.join(CODEX_HOME,'pets',slug);
  if(getBodies().some(b=>b.id===slug))throw new Error(`${slug} is already installed. Its body has been preserved.`);
  try{await fs.access(destination);throw new Error(`${slug} is already installed. Its body has been preserved.`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const p=await communityPet(slug);const zip=await download(p.downloadUrl||`/api/pets/${slug}/download`);
  const {manifest,atlas}=unpackBody(zip,slug);
  const temp=await fs.mkdtemp(path.join(STATE,'community-'));
  try {
    const sheet=path.join(temp,'spritesheet.webp');await fs.writeFile(sheet,atlas);await atlasFrames(sheet);
    const attribution={creator:String(p.ownerHandle||p.ownerName||'Unknown creator'),url:`${ORIGIN}/pets/${slug}`,license:typeof p.license==='string'?p.license:'Artwork license not specified by the catalog'};
    // Only validated artwork and metadata are installed. No executable sheets or hooks.
    await fs.writeFile(path.join(temp,'pet.json'),JSON.stringify({id:slug,displayName:manifest.displayName,description:String(manifest.description||''),spriteVersionNumber:2,spritesheetPath:'spritesheet.webp',petshopSource:attribution,petshopImport:{downloadedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(atlas).digest('hex')}},null,2));
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.mkdir(destination);
    try{await fs.copyFile(sheet,path.join(destination,'spritesheet.webp'));await fs.copyFile(path.join(temp,'pet.json'),path.join(destination,'pet.json'));}catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
  }finally{await fs.rm(temp,{recursive:true,force:true});}
  await scanBodies();return getBodies().find(b=>b.id===slug);
}
export async function adoptCollection(slug:string){const collection=await communityCollection(slug);if(collection.pets.length>50)throw new Error('Adopt collections of at most 50 bodies at a time.');const results=[];for(const p of collection.pets){try{results.push({id:p.id,body:await adoptCommunity(p.id),ok:true});}catch(e){results.push({id:p.id,ok:false,error:(e as Error).message});}}return {name:collection.name,results};}
