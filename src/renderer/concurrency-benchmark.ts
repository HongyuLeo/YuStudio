import type {Project} from '../project/model';
import {timeline, totalFrames} from '../timeline';
export type BenchmarkWindow = {start: number; end: number; label: string};
export type BenchmarkSample = {concurrency:number; window:BenchmarkWindow; frames:number; wallMs:number; measuredFrames:number; measuredMs:number; fps:number; renderRateAfterWarmup?:number; parallelEncoding?:boolean; error?:string};
export type ConcurrencyBenchmark = {orientation:string; requested:number; selected:number; candidates:number[]; windows:BenchmarkWindow[]; samples:BenchmarkSample[]; method:string};
export function concurrencyCandidates(maximum:number, requested:number) {
  return [...new Set([4,8,16,32,maximum,requested].filter(n=>n>=1 && n<=maximum))].sort((a,b)=>a-b);
}
export function benchmarkWindows(project:Project, maximum:number):BenchmarkWindow[] {
  const cues=timeline(project), total=totalFrames(project);
  // All candidates get identical ranges, long enough for multiple batches at
  // the largest candidate. Keep original absolute frames and original props.
  const count=Math.min(total,Math.max(128,maximum*6));
  const heavy=[...cues].sort((a,b)=>(b.track.background?.width??0)*(b.track.background?.height??0)-(a.track.background?.width??0)*(a.track.background?.height??0))[0];
  const fit=(start:number,label:string)=>{const first=Math.max(0,Math.min(total-count,start));return {start:first,end:first+count-1,label};};
  const interior=fit(heavy.start+Math.round(project.fps*2),'最大背景 / 场景中段');
  const warmup=Math.min(Math.floor(count/3),maximum*2);
  const transition=cues.length>1?fit(cues[1].start-Math.round(project.fps*.4)-warmup,'歌曲转场'):fit(Math.floor(total/2),'场景中段');
  return interior.start===transition.start?[interior]:[interior,transition];
}
// Optional drawing-phase diagnostic. Selection uses whole-output time,
// because encoding can run as a short burst after slow drawing finishes.
export class ThroughputClock {
  private first?:{time:number;frames:number};
  private last?:{time:number;frames:number};
  constructor(private readonly warmupFrames:number) {}
  update(time:number,encodedFrames:number) {
    if(encodedFrames<=0 || encodedFrames<this.warmupFrames)return;
    if(!this.first)this.first={time,frames:encodedFrames};
    if(!this.last || encodedFrames>this.last.frames)this.last={time,frames:encodedFrames};
  }
  result(total:number,wallMs:number) {
    const frames=this.first && this.last?this.last.frames-this.first.frames:0;
    const ms=this.first && this.last?this.last.time-this.first.time:0;
    // Short clips or encoders without intermediate progress still have an
    // honest end-to-end fallback; never invent a steady-state measurement.
    return frames>0 && ms>0?{measuredFrames:frames,measuredMs:ms,fps:frames*1000/ms}:{measuredFrames:total,measuredMs:wallMs,fps:total*1000/Math.max(1,wallMs)};
  }
}
export function selectFastestConcurrency(samples:BenchmarkSample[], candidates:number[], windows:BenchmarkWindow[]) {
  const scores=candidates.map(concurrency=>{
    const rows=windows.map(window=>samples.find(s=>s.concurrency===concurrency && s.window.start===window.start && s.window.end===window.end));
    if(rows.some(s=>!s || s.error || !Number.isFinite(s.fps) || s.fps<=0))return {concurrency,fps:0};
    const valid=rows as BenchmarkSample[];
    return {concurrency,fps:valid.reduce((n,s)=>n+s.measuredFrames,0)*1000/Math.max(1,valid.reduce((n,s)=>n+s.measuredMs,0))};
  });
  const best=Math.max(...scores.map(s=>s.fps));
  if(best<=0)throw Error('本机并发测速全部失败，请查看诊断报告中的具体错误。');
  // Within 3% is too small to distinguish reliably in these short samples.
  // Prefer the lower resource load among those near-equal measurements.
  return scores.filter(s=>s.fps>=best*.97).sort((a,b)=>a.concurrency-b.concurrency)[0].concurrency;
}
