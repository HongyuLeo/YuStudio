import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {Asset,Project} from '../project/model';
import type {VideoFrameCache,VideoFrameCaches} from '../project/video-frames';
import {frameFilename} from '../project/video-frames';
import {dataRoot,mediaTool,safeAssetPath,publicSrc} from '../server/paths';
import {probe} from '../server/media';
export const frameCacheRoot=path.join(dataRoot,'video-frames');
type Manifest=Omit<VideoFrameCache,'baseSrc'>&{version:2;key:string;source:string};
export async function prepareVideoFrames(project:Project,origin:string,signal:AbortSignal,onProgress:(message:string)=>void,decodeThreads=2):Promise<{caches:VideoFrameCaches;records:{src:string;frames:number;bytes:number;reused:boolean}[]}> {
  const caches:VideoFrameCaches={},records:{src:string;frames:number;bytes:number;reused:boolean}[]=[];
  const assets=[...new Map(project.tracks.flatMap(t=>t.background?.kind==='video'?[[t.background.src,t.background] as const]:[])).values()];
  await fs.mkdir(frameCacheRoot,{recursive:true});
  for(const [index,asset] of assets.entries()) {
    signal.throwIfAborted();onProgress(`准备背景无损帧缓存 ${index+1}/${assets.length}：${asset.name}`);
    const prepared=await prepareAsset(asset,signal,onProgress,decodeThreads);
    caches[publicSrc(asset.src,origin)]={...prepared.manifest,baseSrc:`${origin}/frames/${prepared.manifest.key}`};
    records.push({src:asset.src,frames:prepared.manifest.timestamps.length,bytes:prepared.manifest.bytes,reused:prepared.reused});
  }
  return {caches,records};
}
async function prepareAsset(asset:Asset,signal:AbortSignal,onProgress:(message:string)=>void,decodeThreads:number) {
  const file=safeAssetPath(asset.src),stat=await fs.stat(file);
  const key=createHash('sha256').update(JSON.stringify([2,file,stat.size,stat.mtimeMs])).digest('hex');
  const final=path.join(frameCacheRoot,key),manifestFile=path.join(final,'ready.json');
  const previous=await fs.readFile(manifestFile,'utf8').then(s=>JSON.parse(s) as Manifest,()=>null).catch(()=>null);
  if(previous?.version===2 && previous.key===key && Array.isArray(previous.timestamps) && previous.timestamps.length>0 && previous.timestamps.every((v,i)=>Number.isFinite(v) && v>=0 && (!i || v>=previous.timestamps[i-1]))) {
    const files=new Set(await fs.readdir(final));
    if(previous.timestamps.every((_,i)=>files.has(frameFilename(i)))){
      let valid=true;
      for(let offset=0;offset<previous.timestamps.length;offset+=32){signal.throwIfAborted();const sizes=await Promise.all(previous.timestamps.slice(offset,offset+32).map((_,i)=>frameSize(path.join(final,frameFilename(offset+i))).catch(()=>0)));if(sizes.some(n=>!n)){valid=false;break;}}
      if(valid)return {manifest:previous,reused:true};
    }
  }
  const folder=path.join(frameCacheRoot,`.work-${randomUUID()}`);await fs.mkdir(folder);
  try {
    const meta=await probe(file),stream=meta.streams.find(s=>s.codec_type==='video');
    if(!stream?.width || !stream.height)throw Error(`背景「${asset.name}」没有有效视频画面。`);
    const timing=JSON.parse(await tool('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',file],signal));
    const raw=timing.frames.map((f:{best_effort_timestamp_time?:string})=>Number(f.best_effort_timestamp_time));
    if(!raw.length || raw.some((v:number,i:number)=>!Number.isFinite(v) || i>0 && v<raw[i-1]))throw Error(`背景「${asset.name}」的帧时间无效，请重新导入。`);
    const timestamps:number[]=raw.map((v:number)=>v-raw[0]);
    // A lossless RGB PNG never requires more than the uncompressed pixels
    // plus modest container/deflate overhead. This is a conservative bound.
    const upperBound=(stream.width*stream.height*3*1.02+65536)*timestamps.length;
    const disk=await fs.statfs(frameCacheRoot).catch(()=>null);
    if(disk && disk.bavail*disk.bsize<upperBound+1024**3)throw Error(`背景「${asset.name}」无损帧缓存最多需要约 ${(upperBound/1024**3).toFixed(1)} GB，当前磁盘可用 ${(disk.bavail*disk.bsize/1024**3).toFixed(1)} GB。请清理磁盘，或在视频背景读取中选择快速读取。`);
    // Imported H.264 loops may have unspecified matrix metadata. The previous
    // compositor/browser path treats these as BT.709; FFmpeg's swscale default
    // differs. Use 709 only when unspecified, respecting an explicit matrix.
    const colorFilter=!stream.color_space || stream.color_space==='unknown'?['-vf','scale=in_color_matrix=bt709:out_color_matrix=bt709']:[];
    await tool('ffmpeg',['-y','-v','error','-threads',String(decodeThreads),'-i',file,'-map','0:v:0','-an','-sn',...colorFilter,'-fps_mode','passthrough','-pix_fmt','rgb24','-c:v','png','-threads','4','-compression_level','1','-start_number','0','-progress','pipe:1',path.join(folder,'%08d.png')],signal,n=>onProgress(`准备「${asset.name}」无损帧缓存 ${Math.min(n,timestamps.length)}/${timestamps.length} 帧`));
    signal.throwIfAborted();
    const files=(await fs.readdir(folder)).filter(n=>/^\d{8}\.png$/.test(n));
    if(files.length!==timestamps.length)throw Error(`背景「${asset.name}」解码帧数不一致，准备已停止。`);
    let bytes=0;
    for(let offset=0;offset<files.length;offset+=32){signal.throwIfAborted();for(const size of await Promise.all(files.slice(offset,offset+32).map(async n=>{
      return await frameSize(path.join(folder,n));
    })))bytes+=size;}
    const manifest:Manifest={version:2,key,source:asset.src,timestamps,width:stream.width,height:stream.height,bytes};
    await fs.writeFile(path.join(folder,'ready.json'),JSON.stringify(manifest));
    await fs.rm(final,{recursive:true,force:true});await fs.rename(folder,final);
    return {manifest,reused:false};
  }finally{await fs.rm(folder,{recursive:true,force:true});}
}
async function frameSize(file:string){
  const handle=await fs.open(file,'r');
  try{const stat=await handle.stat(),head=Buffer.alloc(24),tail=Buffer.alloc(12);if(stat.size<64)throw Error('缓存帧不完整');await handle.read(head,0,24,0);await handle.read(tail,0,12,stat.size-12);if(!head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || tail.subarray(4,8).toString()!=='IEND')throw Error('缓存帧格式无效');return stat.size;}finally{await handle.close();}
}
function tool(name:'ffmpeg'|'ffprobe',args:string[],signal:AbortSignal,onFrame?:(frame:number)=>void):Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=spawn(mediaTool(name),args,{windowsHide:true,signal,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',pending='';const timer=setTimeout(()=>child.kill(),30*60*1000);
    child.stdout.on('data',b=>{if(!onFrame){stdout+=String(b);return;}pending+=String(b);const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){const match=/^frame=(\d+)/.exec(line);if(match)onFrame(Number(match[1]));}});
    child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-6000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);signal.aborted?reject(signal.reason ?? Error('已取消')):code===0?resolve(stdout):reject(Error(`背景帧缓存 ${name} 失败：${stderr.trim() || `退出码 ${code}`}`));});
  });
}
