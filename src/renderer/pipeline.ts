import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {makeCancelSignal, renderMedia, renderStill,selectComposition, ensureBrowser, openBrowser} from '@remotion/renderer';
import type {Project, Orientation} from '../project/model';
import {validateForRender} from '../project/model';
import {chapters,timeline} from '../timeline';
import {dataRoot, outputRoot, publicSrc, root, safeAssetPath} from '../server/paths';
import {chooseEncoder, validatePerformance, machineInfo} from './performance';
import {encodingFrameCount, inspectGraphics, inspectBackgrounds, readVideoObservation, SpeedWindow, type GraphicsInfo, type BackgroundInfo, type VideoReaderObservation} from './diagnostics';
import {encodingOptions, encoderArguments, performanceSettings} from '../project/performance';
import {prepareVideoFrames} from './frame-cache';
import {benchmarkWindows, concurrencyCandidates, selectFastestConcurrency, ThroughputClock, type ConcurrencyBenchmark} from './concurrency-benchmark';
import {attachRuntimeProfiler, type RuntimeProfile} from './runtime-profile';
export type RenderJob = {id: string; state: 'preparing' | 'rendering' | 'done' | 'error' | 'cancelled'; progress: number; message: string; files: {name: string; url: string}[]; startedAt: number;
  performance?: {encoder: string; concurrency: number; cacheMiB: number; videoThreads: number; renderedFps: number; encodedFps: number; elapsedSeconds: number; fallback?: string; recentRenderedFps?: number | null; recentEncodedFps?: number | null; graphics?: GraphicsInfo; tunedConcurrency?:number; parallelEncoding?:boolean};
  diagnostics?: {version:string; machine:ReturnType<typeof machineInfo>; settings:Project['render']; fps:number; benchmarks?:ConcurrencyBenchmark[]; runtimeProfiles?:RuntimeProfile[];liveProfile?:RuntimeProfile; backgrounds:BackgroundInfo[];frameCaches?:{src:string;frames:number;bytes:number;reused:boolean}[];preflight?:{orientation:Orientation;frames:number;wallMs:number}[];videoReaders:VideoReaderObservation[];passes:{orientation:Orientation;width:number;height:number;frames:number;wallMs:number;parallelEncoding:boolean;renderAndConcurrentEncodeMs:number|null;finalStitchMs:number|null;slowestFrames:{frame:number;time:number}[]}[]; notes:string[]}};
export const jobs = new Map<string, RenderJob>();
const cancellations = new Map<string, () => void>();
let active = false;
export const isRenderActive=()=>active;
let bundlePromise: Promise<string> | undefined;
export async function getBundle(onProgress?: (progress: number) => void) {
  const prebuilt = path.join(root, 'remotion-dist');
  if (await fs.access(path.join(prebuilt, 'index.html')).then(() => true, () => false)) return prebuilt;
  if (!bundlePromise) bundlePromise = import('@remotion/bundler').then(({bundle}) => bundle({entryPoint: path.join(root, 'src/compositions/Root.tsx'), outDir: path.join(dataRoot, 'remotion-bundle'), publicDir: path.join(root, 'public'), onProgress})).catch(e => {bundlePromise = undefined; throw e;});
  return bundlePromise;
}
export function forPlayback(project: Project, origin: string): Project {
  return {...project, tracks: project.tracks.map(t => ({...t, audio: {...t.audio, src: publicSrc(t.audio.src, origin)}, background: t.background ? {...t.background, src: publicSrc(t.background.src, origin)} : undefined}))};
}
export async function verifyAssets(project: Project) {
  for (const track of project.tracks) for (const asset of [track.audio, track.background]) {
    if (!asset) continue;
    await fs.access(safeAssetPath(asset.src)).catch(() => {throw new Error(`找不到素材「${asset.name}」。请重新绑定文件，或在原电脑打开此项目。`);});
  }
}
export async function startRender(project: Project, origin: string): Promise<RenderJob> {
  validateForRender(project);
  validatePerformance(project);
  await verifyAssets(project);
  if (active) throw new Error('已有一个导出任务正在运行，请等待或取消。');
  active = true;
  const id = randomUUID();
  const job: RenderJob = {id, state: 'preparing', progress: 0, message: '准备渲染器与本地字体…', files: [], startedAt: Date.now()};
  jobs.set(id, job);
  const signal = makeCancelSignal();
  const probeSignal = new AbortController();
  let cancelled = false;
  cancellations.set(id, () => {cancelled = true; probeSignal.abort(); signal.cancel(); job.state = 'cancelled'; job.message = '已取消，完整输出保留，未完成的文件清理。';});
  void (async () => {
    const folder = path.join(outputRoot, id);
    let renderBrowser: Awaited<ReturnType<typeof openBrowser>> | undefined;
    let profiler:ReturnType<typeof attachRuntimeProfiler>|undefined;
    try {
      await fs.mkdir(folder, {recursive: true});
      await fs.writeFile(path.join(folder, 'project.json'), JSON.stringify(project, null, 2));
      await fs.writeFile(path.join(folder, 'chapters.txt'), chapters(project));
      const settings = performanceSettings(project);
      job.message = settings.encoder === 'cpu' ? '准备 CPU 编码器…' : '检测 NVIDIA NVENC 实际编码能力…';
      const encoder = await chooseEncoder(project, probeSignal.signal);
      if (cancelled) return;
      job.diagnostics={version:'1.3.1',machine:machineInfo(),settings:{...project.render,videoReader:settings.videoReader},fps:project.fps,backgrounds:[],videoReaders:[],passes:[],preflight:[],benchmarks:[],runtimeProfiles:[],notes:['绘图设备来自本次渲染的 Chromium；NVENC 编码器与绘图设备分别记录。','画面阶段含并行编码及等待；finalStitchMs 仅是最终拼接/封装耗时，不能当作编码器全部耗时。','近期速度取最近约 10 秒，累计速度包含本方向启动等待；高并发不保证高吞吐。','并行编码 fps 撤销底层进度 80% 编码 / 20% 封装加权；受底层整数舍入影响，恢复帧数有约一帧误差，封装进度不再冒充编码速度。','默认无损帧缓存绕过 OffthreadVideo 的 compositor 图片通信路径；首次准备使用额外磁盘，后续重复使用。']};
      job.files.push({name:'下载诊断报告.json',url:`/api/render/${id}/diagnostics`});
      job.performance = {encoder: encoder.name, concurrency: project.render.concurrency, cacheMiB: settings.cacheMiB, videoThreads: settings.videoThreads, renderedFps: 0, encodedFps: 0, elapsedSeconds: 0, fallback: encoder.fallback};
      job.diagnostics.backgrounds=await inspectBackgrounds(project);
      const prepared=settings.videoReader==='cached'?await prepareVideoFrames(project,origin,probeSignal.signal,message=>{job.message=message;},settings.videoThreads):undefined;
      if(cancelled)return;
      job.diagnostics.frameCaches=prepared?.records;
      const serveUrl = await getBundle(p => {job.message = `准备画面组件 ${Math.round(p)}%…`;});
      if (cancelled) return;
      const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
      // Downloads once to the user's writable data folder; subsequent launches run offline.
      let browser = browserExecutable;
      if (!browser) {
        const cwd = process.cwd();
        try {
          process.chdir(dataRoot);
          const status = await ensureBrowser({chromeMode: 'headless-shell', logLevel: 'warn', onBrowserDownload: () => ({version: null, onProgress: ({percent}) => {job.message = `首次准备 Chromium ${Math.round(percent * 100)}%…`;}})});
          if (!('path' in status)) throw new Error('Chromium 准备失败。请检查网络，或设置 REMOTION_BROWSER_EXECUTABLE。');
          browser = status.path;
        } finally {process.chdir(cwd);}
      }
      renderBrowser = await openBrowser('chrome', {browserExecutable:browser,chromiumOptions:{gl:settings.gl},logLevel:'warn'});
      profiler=attachRuntimeProfiler(renderBrowser);
      if(cancelled)return;
      const orientations: Orientation[] = [];
      if (project.render.landscape) orientations.push('landscape');
      if (project.render.portrait) orientations.push('portrait');
      for (const [i, orientation] of orientations.entries()) {
        if (cancelled) return;
        const inputProps = {project: forPlayback(project, origin), orientation,frameCaches:prepared?.caches};
        const onBrowserLog=({text}:{text:string})=>{
          const observation=readVideoObservation(text);if(!observation || !job.diagnostics)return;
          const source=project.tracks.map(t=>t.background).find(a=>a && publicSrc(a.src,origin)===observation.src)?.src;
          if(!source)return;
          const record={...observation,src:source,orientation};
          if(!job.diagnostics.videoReaders.some(r=>r.src===record.src && r.orientation===record.orientation && r.backend===record.backend && r.reason===record.reason))job.diagnostics.videoReaders.push(record);
        };
        const composition = await selectComposition({serveUrl, id: orientation === 'landscape' ? 'Landscape' : 'Portrait', inputProps, puppeteerInstance: renderBrowser, browserExecutable: browser, binariesDirectory: process.env.REMOTION_BINARIES_DIRECTORY, chromiumOptions: {gl: settings.gl}, timeoutInMilliseconds: 90000,mediaCacheSizeInBytes:settings.cacheMiB*1024*1024,onBrowserLog});
        if(job.performance && !job.performance.graphics)job.performance.graphics=await inspectGraphics(renderBrowser);
        if(cancelled)return;
        // Validate every bound background at its cue, before an hours-long
        // export. These images are checks only and never enter the final video.
        job.state='preparing';job.message=`生成前检查${orientation==='landscape'?'横屏':'竖屏'}背景与转场…`;
        const preflightStarted=Date.now(),checkFrames=[...new Set(timeline(project).flatMap(c=>[c.start,Math.min(c.end-1,c.start+Math.round(project.fps*.8))]))];
        for(const [check,frame] of checkFrames.entries()){if(cancelled)return;job.message=`生成前检查${orientation==='landscape'?'横屏':'竖屏'}背景与转场 ${check+1}/${checkFrames.length}…`;await renderStill({serveUrl,composition,inputProps,frame,imageFormat:'png',puppeteerInstance:renderBrowser,browserExecutable:browser,binariesDirectory:process.env.REMOTION_BINARIES_DIRECTORY,mediaCacheSizeInBytes:settings.cacheMiB*1024*1024,offthreadVideoThreads:settings.videoThreads,offthreadVideoCacheSizeInBytes:settings.cacheMiB*1024*1024,logLevel:'warn',onBrowserLog,timeoutInMilliseconds:90000});}
        job.diagnostics?.preflight?.push({orientation,frames:checkFrames.length,wallMs:Date.now()-preflightStarted});
        let resolvedConcurrency=project.render.concurrency;
        if(project.render.autoConcurrency){
          const candidates=concurrencyCandidates(machineInfo().maxConcurrency,project.render.concurrency), windows=benchmarkWindows(project,Math.max(...candidates));
          const benchmark:ConcurrencyBenchmark={orientation,requested:project.render.concurrency,selected:project.render.concurrency,candidates,windows,samples:[],method:'相同原始项目、原始绝对帧号和输出画质；按完整样本帧数 / 从开始到视频完成的耗时选择，含页面启动、画面、编码与音频封装，避免编码突发速度掩盖慢绘图。另记预热后画面速度供诊断，不用于单独选档。两场景按总帧数 / 总耗时合并；3% 内视为接近，选较低并发。'};
          job.diagnostics?.benchmarks?.push(benchmark);
          for(const concurrency of candidates)for(const [sampleIndex,window] of windows.entries()){
            if(cancelled)return;
            job.message=`本机测速 ${orientation==='landscape'?'横屏':'竖屏'} · ${concurrency} 并发 · 场景 ${sampleIndex+1}/${windows.length}…`;
            const outputLocation=path.join(folder,`benchmark-${orientation}-${concurrency}-${sampleIndex}.mp4`),started=Date.now(),frames=window.end-window.start+1;
            let benchmarkParallel=false;
            const clock=new ThroughputClock(Math.min(Math.floor(frames/3),Math.max(...candidates)*2));
            profiler?.begin(`benchmark-${orientation}-${concurrency}-${sampleIndex}`);
            try{
              await renderMedia({serveUrl,composition,inputProps,frameRange:[window.start,window.end],codec:project.render.codec,audioCodec:'aac',audioBitrate:'320k',sampleRate:48000,outputLocation,pixelFormat:'yuv420p',...encodingOptions(project,orientation,encoder.hardware),concurrency,
                puppeteerInstance:renderBrowser,browserExecutable:browser,chromiumOptions:{gl:settings.gl},cancelSignal:signal.cancelSignal,binariesDirectory:process.env.REMOTION_BINARIES_DIRECTORY,
                timeoutInMilliseconds:90000,offthreadVideoCacheSizeInBytes:settings.cacheMiB*1024*1024,offthreadVideoThreads:settings.videoThreads,mediaCacheSizeInBytes:settings.cacheMiB*1024*1024,logLevel:'warn',onBrowserLog,
                ffmpegOverride:({args})=>encoderArguments(args,encoder.hardware,settings.speed),onStart:({parallelEncoding})=>{benchmarkParallel=parallelEncoding;},onProgress:value=>{if(job.diagnostics)job.diagnostics.liveProfile=profiler?.snapshot();job.message=`本机测速 ${orientation==='landscape'?'横屏':'竖屏'} · ${concurrency} 并发 · 场景 ${sampleIndex+1}/${windows.length} · ${value.renderedFrames}/${frames} 帧…`;clock.update(Date.now(),value.renderedFrames);if(job.performance)job.performance.elapsedSeconds=Math.round((Date.now()-job.startedAt)/1000);},
              });
              const wallMs=Date.now()-started;benchmark.samples.push({concurrency,window,frames,wallMs,measuredFrames:frames,measuredMs:wallMs,fps:frames*1000/Math.max(1,wallMs),parallelEncoding:benchmarkParallel,renderRateAfterWarmup:clock.result(frames,wallMs).fps});
            }catch(e){
              if(cancelled)return;
              benchmark.samples.push({concurrency,window,frames,wallMs:Date.now()-started,measuredFrames:0,measuredMs:0,fps:0,error:e instanceof Error?e.message:String(e)});
            }finally{const profile=profiler?.end();if(profile)job.diagnostics?.runtimeProfiles?.push(profile);await fs.rm(outputLocation,{force:true}).catch(()=>{});}
          }
          resolvedConcurrency=selectFastestConcurrency(benchmark.samples,candidates,windows);benchmark.selected=resolvedConcurrency;
          if(job.performance)job.performance.tunedConcurrency=resolvedConcurrency;
        }
        job.state='rendering';job.message=(orientation==='landscape'?'渲染横屏影像…':'渲染竖屏影像…')+(project.render.autoConcurrency?`（实测选择 ${resolvedConcurrency} 并发）`:'');
        const filename = orientation === 'landscape' ? `YouTube_${project.render.resolution}_Landscape.mp4` : 'Shorts_1080x1920.mp4';
        const part = path.join(folder, `${filename}.partial.mp4`);
        let renderStarted = Date.now();
        const passStarted=Date.now(), speeds=new SpeedWindow();
        let renderAndConcurrentEncodeMs:number|null=null,finalStitchMs:number|null=null,parallelEncoding=false;
        profiler?.begin(`export-${orientation}`);
        const result = await renderMedia({serveUrl, composition, inputProps, codec: project.render.codec, audioCodec: 'aac', audioBitrate: '320k', sampleRate: 48000,
          outputLocation: part, pixelFormat: 'yuv420p', ...encodingOptions(project, orientation, encoder.hardware), concurrency: resolvedConcurrency,
          puppeteerInstance: renderBrowser, browserExecutable: browser, chromiumOptions: {gl: settings.gl}, cancelSignal: signal.cancelSignal,
          binariesDirectory: process.env.REMOTION_BINARIES_DIRECTORY,
          timeoutInMilliseconds: 90000, offthreadVideoCacheSizeInBytes: settings.cacheMiB * 1024 * 1024, offthreadVideoThreads: settings.videoThreads, mediaCacheSizeInBytes:settings.cacheMiB*1024*1024,logLevel: 'warn',onBrowserLog,
          ffmpegOverride: ({args}) => {
            const actual = args.find(arg => ['h264_nvenc', 'hevc_nvenc', 'libx264', 'libx265'].includes(arg));
            if (actual && job.performance) job.performance.encoder = actual;
            return encoderArguments(args, encoder.hardware, settings.speed);
          },
          onStart: ({resolvedConcurrency,parallelEncoding:parallel}) => {parallelEncoding=parallel; renderStarted = Date.now(); speeds.update(renderStarted,0,0); if (job.performance){job.performance.concurrency = resolvedConcurrency;job.performance.parallelEncoding=parallel;}},
          onProgress: (value) => {
            const {progress,renderedFrames,renderedDoneIn,encodedDoneIn}=value;
            const encodedFrames=encodingFrameCount(value,composition.durationInFrames,parallelEncoding);
            job.progress = (i + progress) / orientations.length;
            if (cancelled) return;
            if(job.diagnostics)job.diagnostics.liveProfile=profiler?.snapshot();
            const now=Date.now(),seconds = Math.max(.001, (now - renderStarted) / 1000);
            const recent=speeds.update(now,renderedFrames,encodedFrames);
            renderAndConcurrentEncodeMs=renderedDoneIn;finalStitchMs=encodedDoneIn;
            if (job.performance) {
              job.performance.renderedFps = Math.round(renderedFrames / seconds * 10) / 10;
              job.performance.encodedFps = Math.round(encodedFrames / seconds * 10) / 10;
              job.performance.recentRenderedFps=recent.rendered;job.performance.recentEncodedFps=recent.encoded;
              job.performance.elapsedSeconds = Math.round((now - job.startedAt) / 1000);
            }
          },
        });
        const passProfile=profiler?.end();if(passProfile)job.diagnostics?.runtimeProfiles?.push(passProfile);
        job.diagnostics?.passes.push({orientation,width:composition.width,height:composition.height,frames:composition.durationInFrames,wallMs:Date.now()-passStarted,parallelEncoding,renderAndConcurrentEncodeMs,finalStitchMs,slowestFrames:result.slowestFrames});
        await fs.rename(part, path.join(folder, filename));
        job.files.push({name: filename, url: `/exports/${id}/${filename}`});
      }
      if (cancelled) return;
      job.files.push({name: 'chapters.txt', url: `/exports/${id}/chapters.txt`}, {name: 'project.json', url: `/exports/${id}/project.json`});
      if (job.performance) job.performance.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
      await fs.writeFile(path.join(folder, 'performance.json'), JSON.stringify({...job.performance,diagnostics:job.diagnostics}, null, 2));
      job.files.push({name: 'performance.json', url: `/exports/${id}/performance.json`});
      job.progress = 1; job.state = 'done'; job.message = '导出完成';
    } catch (e) {
      if (!cancelled) {job.state = 'error'; job.message = e instanceof Error ? e.message : String(e);}
    } finally {
      const pendingProfile=profiler?.end();if(pendingProfile)job.diagnostics?.runtimeProfiles?.push(pendingProfile);
      profiler?.dispose();
      if(job.diagnostics)delete job.diagnostics.liveProfile;
      if(renderBrowser)await renderBrowser.close({silent:true}).catch(()=>{});
      if(job.performance) {
        job.performance.elapsedSeconds=Math.round((Date.now()-job.startedAt)/1000);
        await fs.writeFile(path.join(folder,'diagnostics.json'),JSON.stringify({state:job.state,message:job.message,performance:job.performance,...job.diagnostics},null,2)).catch(()=>{});
      }
      for (const file of await fs.readdir(folder).catch(() => [])) if (file.endsWith('.partial.mp4') || /^benchmark-.*\.mp4$/.test(file)) await fs.rm(path.join(folder, file), {force: true});
      active = false; cancellations.delete(id);
    }
  })();
  return job;
}
export function cancelJob(id: string) {cancellations.get(id)?.();}
