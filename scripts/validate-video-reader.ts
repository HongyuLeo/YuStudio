import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ensureBrowser} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {startRender} from '../src/renderer/pipeline';
import {assetsRoot,outputRoot} from '../src/server/paths';
import {runTool,probe} from '../src/server/media';
import {projectSchema} from '../src/project/model';
if(process.env.NOCTURNE_QA_SANDBOX==='1')os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server,port}=await createStudioServer(0,true);
const status=(process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));if(!('path' in status))throw Error('No browser');process.env.REMOTION_BROWSER_EXECUTABLE=status.path;
const project=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
project.fps=60;project.tracks=project.tracks.slice(0,1);project.tracks[0].artist='';project.tracks[0].audio.duration=.6;
project.render={...project.render,landscape:true,portrait:false,resolution:'1080p',encoder:'cpu',speed:'fast',concurrency:4,videoThreads:4,cacheMiB:512,gl:'swiftshader'};
const file=path.join(assetsRoot,'reader-fallback-qa.mp4');
try {
 await runTool('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=0.2','-c:v','mpeg4','-q:v','2','-pix_fmt','yuv420p',file]);
 project.tracks[0].background={src:'assets/reader-fallback-qa.mp4',name:'WebCodecs unsupported MPEG4 fixture',kind:'video',duration:.2,width:640,height:360};
 const reports=[];
 for(const videoReader of ['auto','legacy'] as const){
  project.render.videoReader=videoReader;
  let job:Awaited<ReturnType<typeof startRender>>|undefined;
  for(let attempt=0;attempt<60 && !job;attempt++)try{job=await startRender(project,`http://127.0.0.1:${port}`);}catch(e){if(!String(e).includes('已有一个'))throw e;await new Promise(r=>setTimeout(r,100));}
  assert.ok(job);const until=Date.now()+120000;
  while(['preparing','rendering'].includes(job.state)){assert.ok(Date.now()<until,'Timed out');await new Promise(r=>setTimeout(r,100));}
  assert.equal(job.state,'done',job.message);
  const report=await fetch(`http://127.0.0.1:${port}/api/render/${job.id}/diagnostics`).then(r=>r.json());
  assert.equal(report.backgrounds[0].codec,'mpeg4');
  assert.ok(report.videoReaders.some((r:{backend:string;reason?:string})=>r.backend==='frame-cache'));
  assert.ok(!report.videoReaders.some((r:{backend:string})=>r.backend==='webcodecs' || r.backend==='ffmpeg'));
  assert.equal(report.frameCaches[0].reused,videoReader==='legacy');
  const meta=await probe(path.join(outputRoot,job.id,'YouTube_1080p_Landscape.mp4'));
  assert.equal(meta.streams.find(s=>s.codec_type==='video')?.width,1920);assert.ok(meta.streams.some(s=>s.codec_type==='audio'));
  reports.push({videoReader,report});console.log('PASS:',videoReader,'old project setting uses cached MPEG4 frames at 1080p60, with audio and no compositor fallback.');
 }
 project.render.videoReader='auto';project.render.readerVersion=2;
 await new Promise(r=>setTimeout(r,200));
 const quick=await startRender(project,`http://127.0.0.1:${port}`);while(['preparing','rendering'].includes(quick.state))await new Promise(r=>setTimeout(r,100));
 assert.equal(quick.state,'error');assert.equal(quick.diagnostics?.passes.length,0);assert.ok(!quick.files.some(f=>f.name.endsWith('.mp4')));
 console.log('PASS: explicit browser-only unsupported MPEG4 fails during preflight with no output render pass.');
 await fs.writeFile('deliverables/video-reader-cache-qa.json',JSON.stringify({reports,quick},null,2));
}finally{await fs.rm(file,{force:true});server.close();}
