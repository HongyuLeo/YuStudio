import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStudioServer} from '../src/server/index';
import {outputRoot,assetsRoot} from '../src/server/paths';
import {projectSchema} from '../src/project/model';
import {probe} from '../src/server/media';
import {jobs,isRenderActive} from '../src/renderer/pipeline';
import {selectFastestConcurrency} from '../src/renderer/concurrency-benchmark';
if(process.env.NOCTURNE_QA_SANDBOX==='1')os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server,port}=await createStudioServer(0,true),origin=`http://127.0.0.1:${port}`;
const require=createRequire(import.meta.url),{chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({executablePath:process.env.REMOTION_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let sawLiveProfile=false;const monitor=setInterval(()=>{if([...jobs.values()].some(j=>(j.diagnostics?.liveProfile?.capture.calls??0)>0))sawLiveProfile=true;},500);
const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
const project=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
project.fps=60;project.tracks=project.tracks.slice(0,2);project.tracks.forEach(t=>{t.artist='';t.audio.duration=3;t.background={src:'assets/tune-loop.mp4',name:'tune loop',kind:'video',width:1280,height:720,duration:1};});
project.render={...project.render,encoder:'cpu',speed:'fast',gl:'swiftshader',concurrency:8,autoConcurrency:true,resolution:'4k',landscape:true,portrait:true,cacheMiB:512,videoThreads:2};
async function post(url:string,value:unknown={}){const response=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(response.status,200,await response.clone().text());return response.json();}
async function wait(id:string,predicate:(j:any)=>boolean,timeout=600000){const until=Date.now()+timeout;while(Date.now()<until){const job=await fetch(`${origin}/api/render/${id}`).then(r=>r.json());if(predicate(job))return job;if(job.state==='error')throw Error(job.message);await new Promise(r=>setTimeout(r,200));}throw Error('QA timeout');}
try{
  await fs.access(path.join(assetsRoot,'tune-loop.mp4'));
  await page.goto(origin);await page.getByRole('button',{name:'全力输出',exact:true}).click();assert.equal(await page.getByLabel('实测最快并发',{exact:true}).isChecked(),true);
  await page.getByLabel('渲染并发',{exact:true}).fill('4');assert.equal(await page.getByLabel('实测最快并发',{exact:true}).isChecked(),false);
  await page.getByLabel('实测最快并发',{exact:true}).check();await page.reload();assert.equal(await page.getByLabel('实测最快并发',{exact:true}).isChecked(),true);
  console.log('PASS full-power enables autotune; manual concurrency disables it; explicit choice persists.');
  await page.evaluate((p:unknown)=>localStorage.setItem('nocturne.project.v1',JSON.stringify(p)),project);await page.reload();await page.getByRole('button',{name:'生成音乐影像',exact:true}).click();
  await page.getByText('作品已就绪',{exact:true}).waitFor({timeout:600000});
  const actual=[...jobs.values()].find(j=>j.state==='done');assert.ok(actual);const id=actual.id;const completed=JSON.parse(await fs.readFile(path.join(outputRoot,id,'performance.json'),'utf8'));
  assert.ok(completed);const diagnostics=completed.diagnostics;
  for(const benchmark of diagnostics.benchmarks){assert.equal(benchmark.selected,selectFastestConcurrency(benchmark.samples,benchmark.candidates,benchmark.windows));assert.ok(benchmark.samples.every((s:any)=>!s.error && s.fps>0 && Math.abs(s.fps-s.frames*1000/s.wallMs)<1e-8));}
  for(const pass of diagnostics.passes){const filename=pass.orientation==='landscape'?'YouTube_4k_Landscape.mp4':'Shorts_1080x1920.mp4';const media=await probe(path.join(outputRoot,id,filename));const video=media.streams.find(s=>s.codec_type==='video')!;assert.equal(video.width,pass.width);assert.equal(video.height,pass.height);assert.equal(video.avg_frame_rate,'60/1');assert.equal(Number(video.duration),6);assert.ok(Math.abs(Number(media.format.duration)-6)<1024/48000+.001);assert.equal((media.streams.find(s=>s.codec_type==='audio') as {sample_rate?:string}|undefined)?.sample_rate,'48000');}
  assert.equal(sawLiveProfile,true);assert.ok(diagnostics.passes.every((p:any)=>typeof p.parallelEncoding==='boolean'));
  assert.ok(diagnostics.runtimeProfiles.some((p:any)=>p.capture.calls>0 && p.browserCommands.calls>0 && p.availableMemoryMinMiB>0));
  assert.ok(!(await fs.readdir(path.join(outputRoot,id))).some(f=>/^benchmark-|\.partial\.mp4$/.test(f)));
  await fs.writeFile('deliverables/concurrency-v1.2.5-qa.json',JSON.stringify({host:'Linux CPU/SwiftShader; no NVIDIA available',diagnostics},null,2));await page.screenshot({path:'deliverables/concurrency-v1.2.5-ui.png',fullPage:true});
  console.log('PASS real UI -> cache -> two-scene concurrency measurement -> 4K60 + portrait60 export, audio, profiles and sample cleanup.',JSON.stringify(diagnostics.benchmarks.map((b:any)=>({orientation:b.orientation,selected:b.selected,samples:b.samples.map((s:any)=>({concurrency:s.concurrency,fps:s.fps,wallMs:s.wallMs}))}))));
  const started=await post('/api/render',project);await wait(started.id,j=>j.message.includes('本机测速'));await post(`/api/render/${started.id}/cancel`);const cancelled=await wait(started.id,j=>j.state==='cancelled');assert.equal(cancelled.state,'cancelled');
  const cleanupUntil=Date.now()+15000;while(isRenderActive() && Date.now()<cleanupUntil)await new Promise(r=>setTimeout(r,100));assert.equal(isRenderActive(),false);assert.ok(!(await fs.readdir(path.join(outputRoot,started.id))).some(f=>f.endsWith('.mp4')));assert.deepEqual(errors,[]);
  console.log('PASS cancel during benchmark, no MP4 leftovers or frontend errors.');
}finally{clearInterval(monitor);await browser.close();server.close();}
