import type {openBrowser} from '@remotion/renderer';
import fs from 'node:fs/promises';
import type {Project,Orientation,Asset} from '../project/model';
import {safeAssetPath} from '../server/paths';
import {probe} from '../server/media';
// Remotion 4.0.532 reports round(.8 * encoded + .2 * muxed), not raw
// encoded frames. Parallel rendering has no muxed frames until stitchStage
// becomes muxing, at which point all video frames have finished encoding.
// Reverse the known weight; the rounded input limits accuracy to ~one frame.
export function encodingFrameCount(value:{encodedFrames:number;stitchStage:'encoding'|'muxing'},total:number,parallelEncoding:boolean) {
  return Math.min(total,Math.max(0,parallelEncoding?(value.stitchStage==='muxing'?total:Math.round(value.encodedFrames/.8)):value.encodedFrames));
}
export type VideoReaderObservation={orientation:Orientation;src:string;backend:'webcodecs'|'ffmpeg'|'frame-cache'|'failed';reason?:string};
export function readVideoObservation(text:string):Omit<VideoReaderObservation,'orientation'>|null {
  const marker='NOCTURNE_VIDEO:',start=text.indexOf(marker);
  if(start<0)return null;
  try {
    const v=JSON.parse(text.slice(start+marker.length));
    if(typeof v.src!=='string' || !['webcodecs','ffmpeg','frame-cache','failed'].includes(v.backend))return null;
    return {src:v.src,backend:v.backend,reason:typeof v.reason==='string'?v.reason.slice(0,1000):undefined};
  }catch{return null;}
}
export type BackgroundInfo={src:string;name:string;kind:Asset['kind'];width?:number;height?:number;duration?:number;loopPrepared?:boolean;fileBytes?:number;codec?:string;frameRate?:string;pixelFormat?:string;bitRate?:string;error?:string};
export async function inspectBackgrounds(project:Project):Promise<BackgroundInfo[]> {
  const unique=[...new Map(project.tracks.flatMap(t=>t.background?[[t.background.src,t.background] as const]:[])).values()];
  const results:BackgroundInfo[]=[];
  // Bound metadata probing separately from the user's render concurrency.
  for(let offset=0;offset<unique.length;offset+=4)results.push(...await Promise.all(unique.slice(offset,offset+4).map(async asset=>{
    const info:BackgroundInfo={src:asset.src,name:asset.name,kind:asset.kind,width:asset.width,height:asset.height,duration:asset.duration,loopPrepared:asset.loopPrepared};
    try {
      const file=safeAssetPath(asset.src);info.fileBytes=(await fs.stat(file)).size;
      if(asset.kind==='video'){
        const metadata=await probe(file),stream=metadata.streams.find(s=>s.codec_type==='video');
        info.width=stream?.width ?? info.width;info.height=stream?.height ?? info.height;
        info.codec=stream?.codec_name;info.frameRate=stream?.avg_frame_rate;info.pixelFormat=stream?.pix_fmt;info.bitRate=stream?.bit_rate;
        const duration=Number(metadata.format.duration ?? stream?.duration);if(Number.isFinite(duration) && duration>0)info.duration=duration;
      }
    }catch(e){info.error=e instanceof Error?e.message:String(e);}
    return info;
  })));
  return results;
}
export type GraphicsInfo = {device: string; renderer?: string; compositing?: string; rasterization?: string; software?: boolean; error?: string};
export type ChromiumSystemInfo = {gpu?: {devices?: {vendorString?: string; deviceString?: string; driverVersion?: string}[]; auxAttributes?: Record<string, unknown>; featureStatus?: Record<string,string>}};
export function graphicsInfo(info: ChromiumSystemInfo): GraphicsInfo {
  const gpu=info.gpu;
  const renderer=typeof gpu?.auxAttributes?.glRenderer === 'string' ? gpu.auxAttributes.glRenderer : undefined;
  const device=gpu?.devices?.map(d => [d.vendorString,d.deviceString].filter(Boolean).join(' ')).filter(Boolean).join(' / ') || '设备未报告';
  const compositing=gpu?.featureStatus?.gpu_compositing,rasterization=gpu?.featureStatus?.rasterization;
  // A requested ANGLE backend is not proof of hardware rendering. Report
  // Chromium's actual feature status and renderer; unknown stays unknown.
  const software=/swiftshader|llvmpipe|softpipe|basic render driver/i.test(renderer || '') || compositing?.includes('software') === true;
  return {device,renderer,compositing,rasterization,software:software ? true : compositing==='enabled' ? false : undefined};
}
export async function inspectGraphics(browser: Awaited<ReturnType<typeof openBrowser>>): Promise<GraphicsInfo> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // SystemInfo is a browser CDP domain. Keep the small adapter here because
    // Remotion's pinned connection typing only lists the domains it uses itself.
    const send=browser.connection.send as unknown as (method:string)=>Promise<{value:ChromiumSystemInfo}>;
    const result=await Promise.race([send.call(browser.connection,'SystemInfo.getInfo'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('绘图设备检测超时')),5000);})]);
    return graphicsInfo(result.value);
  } catch(e) {return {device:'设备检测未完成',error:e instanceof Error ? e.message : String(e)};}
  finally {if(timer)clearTimeout(timer);}
}
export class SpeedWindow {
  private samples: {time:number; rendered:number; encoded:number}[]=[];
  constructor(private readonly durationMs=10000) {}
  update(time:number,rendered:number,encoded:number) {
    this.samples.push({time,rendered,encoded});
    // Retain one point at/before the boundary to avoid noisy sub-second rates.
    while(this.samples.length>2 && this.samples[1].time<=time-this.durationMs)this.samples.shift();
    const first=this.samples[0],seconds=(time-first.time)/1000;
    return {rendered:seconds>=1 ? Math.round(Math.max(0,rendered-first.rendered)/seconds*10)/10 : null,
      encoded:seconds>=1 ? Math.round(Math.max(0,encoded-first.encoded)/seconds*10)/10 : null};
  }
}
