import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import sharp from 'sharp';
import { CODEX_HOME, STATE, assertId, expand } from './paths.ts';
import type { Body } from './types.ts';

const files = new Map<string,string>();
let inventory: Body[] = [];
const frameCache = new Map<string, number[]>();
export async function atlasFrames(file: string) {
  const stat = await fs.stat(file); const key = `${file}:${stat.mtimeMs}`;
  if(frameCache.has(key)) return frameCache.get(key)!;
  const image = sharp(file); const meta = await image.metadata();
  if(meta.width !== 1536 || meta.height !== 2288 || !meta.hasAlpha) throw new Error('Expected a transparent Codex v2 atlas: 1536 × 2288.');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  const rows: number[] = [];
  for(let row=0;row<11;row++) {
    let last = 0;
    for(let col=0;col<8;col++) {
      let occupied = false;
      for(let y=row*208; y<(row+1)*208 && !occupied;y++) for(let x=col*192;x<(col+1)*192;x++) if(data[(y*1536+x)*info.channels+3]>0){occupied=true;break;}
      if(occupied) last=col+1;
    }
    if(!last || (row>=9 && last!==8)) throw new Error(`Atlas row ${row} is incomplete.`);
    rows.push(last);
  }
  frameCache.set(key,rows); return rows;
}
async function addBody(id:string,name:string,description:string,origin:string,source:string,file:string,attribution?:Body['attribution']) {
  assertId(id); const frames = await atlasFrames(file); files.set(id,file);
  inventory.push({id,name,description,origin,source,url:`/api/bodies/${id}/atlas`,frames,attribution});
}
export async function scanBodies() {
  inventory=[]; files.clear(); const errors:string[]=[];
  for(const dir of [path.join(CODEX_HOME,'pets'),path.join(STATE,'bodies')]) {
    for(const id of await fs.readdir(dir).catch(()=>[])) {
      try {
        const manifestFile=path.join(dir,id,'pet.json'); const m=JSON.parse(await fs.readFile(manifestFile,'utf8'));
        if(m.spriteVersionNumber!==2) throw new Error('Only v2 bodies are supported.');
        const file=path.resolve(dir,id,m.spritesheetPath || 'spritesheet.webp');
        if(!file.startsWith(path.resolve(dir,id)+path.sep)) throw new Error('Sprite must be inside its pet package.');
        if(files.has(m.id)) continue;
        await addBody(m.id,m.displayName,m.description,m.petshopSource?'community':dir.includes(STATE)?'imported':'custom',manifestFile,file,m.petshopSource);
      } catch(e){ if((e as NodeJS.ErrnoException).code!=='ENOENT') errors.push(`${id}: ${(e as Error).message}`); }
    }
  }
  const asar=process.env.PETSHOP_ASAR || '/usr/lib/chatgpt/resources/app.asar';
  try {
    const entries=listPackage(asar,{isPack:false}); const names:Record<string,string>={bsod:'BSOD',codex:'Codex',dewey:'Dewey',fireball:'Fireball',hoots:'Hoots','null-signal':'Null Signal',rocky:'Rocky',seedy:'Seedy',stacky:'Stacky'};
    const candidates = entries.filter(p=>/-spritesheet-v\d+-[^/]+\.webp$/.test(p));
    for(const [id,name] of Object.entries(names)) {
      if(files.has(id)) continue;
      const matches=candidates.filter(p=>path.basename(p).startsWith(`${id}-spritesheet-`)).sort((a,b)=>Number(b.match(/-v(\d+)-/)?.[1])-Number(a.match(/-v(\d+)-/)?.[1]));
      if(!matches[0]) continue;
      try {
        const dir=path.join(STATE,'cache'); await fs.mkdir(dir,{recursive:true}); const file=path.join(dir,path.basename(matches[0]));
        try { await fs.access(file); } catch { await fs.writeFile(file,extractFile(asar,matches[0].replace(/^\//,''))); }
        await addBody(id,name,'Companion from your installed Codex desktop app.','bundled',asar,file);
      } catch(e) { errors.push(`${id}: ${(e as Error).message}`); }
    }
  } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') errors.push(`Desktop companions: ${(e as Error).message}`); }
  return {bodies:inventory,errors};
}
export const bodyFile = (id:string) => files.get(id);
export const getBodies = () => inventory;
export async function importBody(source:string,id?:string) {
  let sourcePath=expand(source); const stat=await fs.stat(sourcePath);
  if(stat.isDirectory()) sourcePath=path.join(sourcePath,'pet.json');
  const m=JSON.parse(await fs.readFile(sourcePath,'utf8'));
  const bodyId=id || m.id; assertId(bodyId);
  if(files.has(bodyId))throw new Error(`Body ${bodyId} is already installed. Choose a new ID to preserve both.`);
  if(m.spriteVersionNumber!==2 || typeof m.displayName!=='string') throw new Error('Expected a Codex v2 pet.json manifest.');
  const src=path.resolve(path.dirname(sourcePath),m.spritesheetPath || 'spritesheet.webp');
  const real=await fs.realpath(src); const parent=await fs.realpath(path.dirname(sourcePath));
  if(!real.startsWith(parent+path.sep)) throw new Error('Sprite must be inside its pet package.');
  await atlasFrames(real);
  const dir=path.join(STATE,'bodies',bodyId); await fs.mkdir(dir); // Never overwrite an existing import.
  const ext=path.extname(real).toLowerCase(); const filename=ext==='.png'?'spritesheet.png':'spritesheet.webp';
  try {
    await fs.copyFile(real,path.join(dir,filename));
    await fs.writeFile(path.join(dir,'pet.json'),JSON.stringify({...m,id:bodyId,spritesheetPath:filename},null,2));
  } catch(e) { await fs.rm(dir,{recursive:true,force:true}); throw e; }
  return scanBodies();
}
