import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ensureBrowser,openBrowser,selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {forPlayback} from '../src/renderer/pipeline';
import {projectSchema} from '../src/project/model';
import {prepareVideoFrames} from '../src/renderer/frame-cache';
import {assetsRoot} from '../src/server/paths';
import {probe,runTool} from '../src/server/media';
if(process.env.NOCTURNE_QA_SANDBOX==='1')os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server,port}=await createStudioServer(0,true);
const status=(process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));if(!('path' in status))throw Error('No browser');
const browser=await openBrowser('chrome',{browserExecutable:status.path,chromiumOptions:{gl:'swiftshader'},logLevel:'warn'});
const p=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
p.fps=60;p.render.resolution='4k';p.tracks=p.tracks.slice(0,1);p.tracks[0].audio.duration=12;p.tracks[0].artist='';
const sourceWidth=process.argv.includes('--source4k')?3840:1920;
const prefix=sourceWidth===3840?'cache-video4k':'cache-video';
p.tracks[0].background={src:sourceWidth===3840?'assets/reader-benchmark-4k.mp4':'assets/reader-benchmark.mp4',name:`${sourceWidth}x${sourceWidth*9/16} H264 30fps 8s GOP250`,kind:'video',duration:8,width:sourceWidth,height:sourceWidth*9/16};
p.tracks[0].atmosphere={preset:'snow',amount:.75};
const results=[];
try {
 const fixture=path.join(assetsRoot,'reader-benchmark.mp4');
 const valid=async(file:string)=>await probe(file).then(info=>Number(info.format.duration)===8,()=>false);
 if(!await valid(fixture))await runTool('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=8','-c:v','libx264','-threads','4','-preset','veryfast','-crf','18','-g','250','-pix_fmt','yuv420p','-movflags','+faststart',fixture]);
 const fixture4k=path.join(assetsRoot,'reader-benchmark-4k.mp4');
 if(sourceWidth===3840 && !await valid(fixture4k))await runTool('ffmpeg',['-y','-v','error','-i',fixture,'-vf','scale=3840:2160','-c:v','libx264','-threads','4','-preset','ultrafast','-crf','18','-g','250','-pix_fmt','yuv420p','-movflags','+faststart',fixture4k]);
 const baseline=process.env.NOCTURNE_BENCHMARK_BASELINE || '../baseline-remotion-v1.2.3';
 const baselineExists=await fs.access(path.join(baseline,'index.html')).then(()=>true,()=>false);
 const runs=[{label:'legacy-before',bundle:baselineExists?baseline:'remotion-dist',reader:'legacy' as const},{label:'cached',bundle:'remotion-dist',reader:'cached' as const}];
 let preparationSeconds=0;
 for(const {label,bundle,reader} of runs){
   p.render.videoReader=reader;
   const observations:string[]=[];
   const prepStart=Date.now();const prepared=reader==='cached'?await prepareVideoFrames(p,`http://127.0.0.1:${port}`,new AbortController().signal,()=>{},2):undefined;if(prepared)preparationSeconds=(Date.now()-prepStart)/1000;
   const inputProps={project:forPlayback(p,`http://127.0.0.1:${port}`),orientation:'landscape',frameCaches:prepared?.caches};
   const opts={serveUrl:path.resolve(bundle),inputProps,puppeteerInstance:browser,chromiumOptions:{gl:'swiftshader' as const},logLevel:'warn' as const,onBrowserLog:(log:{text:string})=>{if(log.text.includes('NOCTURNE_VIDEO:') || /falling back/.test(log.text))observations.push(log.text);}};
   const composition=await selectComposition({...opts,id:'Landscape'});
   for(const frame of sourceWidth===3840?[180]:[0,1,2,11,180,479,480,500])await renderStill({...opts,composition,frame,imageFormat:'png',output:path.resolve(`deliverables/${prefix}-${label}-${frame}.png`)});
   const start=Date.now();let progress:unknown;
   const result=await renderMedia({...opts,composition,frameRange:[180,239],codec:'h264',hardwareAcceleration:'disable',x264Preset:'veryfast',crf:18,concurrency:4,outputLocation:path.resolve(`deliverables/${prefix}-${label}.mp4`),onProgress:value=>{progress=value;},offthreadVideoThreads:4,offthreadVideoCacheSizeInBytes:512*1024*1024,mediaCacheSizeInBytes:512*1024*1024});
   const entry={label,seconds:(Date.now()-start)/1000,observations:[...new Set(observations)],progress,slowestFrames:result.slowestFrames};results.push(entry);console.log(JSON.stringify(entry));
 }
 await fs.writeFile(`deliverables/benchmark-${prefix}.json`,JSON.stringify({host:'Linux CPU/SwiftShader, no NVIDIA GPU',output:'3840x2160 60fps',frames:[180,239],concurrency:4,source:p.tracks[0].background,preparationSeconds,results},null,2));
} finally {await browser.close({silent:true});server.close();}
