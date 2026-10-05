import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {startRender, cancelJob, forPlayback, getBundle} from '../src/renderer/pipeline';
import {assetsRoot,outputRoot} from '../src/server/paths';
import {probe} from '../src/server/media';
import {projectSchema} from '../src/project/model';
if(process.env.NOCTURNE_QA_SANDBOX==='1')os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server,port}=await createStudioServer(0,true),origin=`http://127.0.0.1:${port}`;
const status=(process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));if(!('path' in status))throw Error('No browser');process.env.REMOTION_BROWSER_EXECUTABLE=status.path;
const demo=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
async function wait(job:Awaited<ReturnType<typeof startRender>>) {const until=Date.now()+180000;while(['preparing','rendering'].includes(job.state)){if(Date.now()>until)throw Error('Timeout');await new Promise(r=>setTimeout(r,150));}return job;}
const video=path.join(assetsRoot,'optimization-qa-loop.mp4');
try {
 await new Promise<void>((resolve,reject)=>{const p=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=0.2','-c:v','libx264','-pix_fmt','yuv420p',video],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('Video fixture failed')));});
 demo.fps=60;demo.tracks=demo.tracks.slice(0,2).map((t,i)=>({...t,artist:'',audio:{...t.audio,duration:1},background:{src:'assets/optimization-qa-loop.mp4',kind:'video' as const,name:'loop',width:640,height:360,duration:.2},atmosphere:{preset:i===0?'snow' as const:'fireflies' as const,amount:.75}}));
 demo.render={...demo.render,landscape:true,portrait:true,resolution:'4k',concurrency:4,encoder:'cpu',speed:'fast',gl:'swiftshader',videoThreads:4,cacheMiB:512};
 const job=await startRender(demo,origin);
 while(!job.diagnostics && job.state==='preparing')await new Promise(r=>setTimeout(r,50));
 const runningReport=await fetch(`${origin}/api/render/${job.id}/diagnostics`).then(r=>r.json());assert.equal(runningReport.version,'1.2.4');
 await wait(job);assert.equal(job.state,'done',job.message);assert.equal(job.diagnostics?.passes.length,2);assert.ok(job.performance?.graphics);assert.ok(!job.performance.graphics.error,job.performance.graphics.error);
 const completedReport=await fetch(`${origin}/api/render/${job.id}/diagnostics`).then(r=>r.json());assert.equal(completedReport.passes.length,2);assert.equal(completedReport.settings.concurrency,4);
 assert.equal(completedReport.backgrounds.length,1);assert.equal(completedReport.backgrounds[0].codec,'h264');assert.equal(completedReport.backgrounds[0].frameRate,'30/1');
 assert.ok(completedReport.videoReaders.some((r:{backend:string;orientation:string})=>r.backend==='frame-cache' && r.orientation==='landscape'));
 assert.ok(completedReport.videoReaders.some((r:{backend:string;orientation:string})=>r.backend==='frame-cache' && r.orientation==='portrait'));
 assert.ok(!completedReport.videoReaders.some((r:{backend:string})=>r.backend==='ffmpeg'));
 for(const [filename,w,h] of [['YouTube_4k_Landscape.mp4',3840,2160],['Shorts_1080x1920.mp4',1080,1920]] as const) {
  const file=path.join(outputRoot,job.id,filename),meta=await probe(file);const streams=meta.streams as {codec_type:string;width?:number;height?:number;r_frame_rate?:string;sample_rate?:string}[];const stream=streams.find(s=>s.codec_type==='video');assert.equal(stream?.width,w);assert.equal(stream?.height,h);assert.equal(stream?.r_frame_rate,'60/1');assert.equal(streams.find(s=>s.codec_type==='audio')?.sample_rate,'48000');
 }
 await fs.writeFile('deliverables/optimization-diagnostics-qa.json',JSON.stringify(completedReport,null,2));
 console.log('PASS: 4K60 + portrait60, repeated video background, cut between snow/fireflies, audio and two browser-reused passes, live/downloaded GPU diagnostics.');
 // Both orientation texture sets, all three presets, and an overlap frame.
 const opts={serveUrl:await getBundle(),browserExecutable:status.path,chromiumOptions:{gl:'swiftshader' as const},logLevel:'warn' as const};
 for(const orientation of ['landscape','portrait'] as const) {
  for(const preset of ['snow','embers','fireflies'] as const) {
   const p={...demo,tracks:[{...demo.tracks[0],background:projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8'))).tracks[0].background,audio:{...demo.tracks[0].audio,duration:7},atmosphere:{preset,amount:.75}}]};
   const inputProps={project:forPlayback(p,origin),orientation},composition=await selectComposition({...opts,id:orientation==='landscape'?'Landscape':'Portrait',inputProps});
   await renderStill({...opts,composition,inputProps,frame:180,imageFormat:'png',output:path.resolve(`deliverables/optimized-${orientation}-${preset}.png`)});
  }
  const inputProps={project:forPlayback(demo,origin),orientation},composition=await selectComposition({...opts,id:orientation==='landscape'?'Landscape':'Portrait',inputProps});
  await renderStill({...opts,composition,inputProps,frame:60,imageFormat:'png',output:path.resolve(`deliverables/optimized-${orientation}-transition.png`)});
 }
 // Cancellation must release browser/process resources before another job.
 const long={...demo,render:{...demo.render,portrait:false,resolution:'1080p' as const},tracks:[{...demo.tracks[0],audio:{...demo.tracks[0].audio,duration:7}}]};
 const cancelled=await startRender(long,origin);while(cancelled.state==='preparing')await new Promise(r=>setTimeout(r,100));cancelJob(cancelled.id);assert.equal(cancelled.state,'cancelled');
 let retry:Awaited<ReturnType<typeof startRender>>|undefined;
 for(let i=0;i<50 && !retry;i++){try {retry=await startRender({...long,tracks:[{...long.tracks[0],audio:{...long.tracks[0].audio,duration:.2}}]},origin);}catch(e){if(!String(e).includes('已有一个'))throw e;await new Promise(r=>setTimeout(r,100));}}
 assert.ok(retry);await wait(retry);assert.equal(retry.state,'done',retry.message);assert.ok(!(await fs.readdir(path.join(outputRoot,cancelled.id))).some(f=>f.endsWith('.partial.mp4')));
 console.log('PASS: all six atmosphere/orientation stills, overlap, cancel cleanup and subsequent export.');
} finally {await fs.rm(video,{force:true});server.close();}
