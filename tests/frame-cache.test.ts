import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {newProject} from '../src/project/model';
import {cachedFrameAt,frameFilename} from '../src/project/video-frames';
import {prepareVideoFrames,frameCacheRoot} from '../src/renderer/frame-cache';
import {assetsRoot,mediaTool} from '../src/server/paths';
test('timestamp lookup preserves repeated/VFR source frames and clamps boundaries',()=>{
 const ts=[0,.03,.09,.10];assert.equal(cachedFrameAt(ts,-.1),0);assert.equal(cachedFrameAt(ts,.08),1);assert.equal(cachedFrameAt(ts,.09),2);assert.equal(cachedFrameAt(ts,10),3);assert.equal(frameFilename(32),'00000032.png');
});
test('lossless background cache decodes once, reuses, repairs missing frames and cancels cleanly',async()=>{
 const name=`cache-qa-${Date.now()}.mp4`,file=path.join(assetsRoot,name),created:string[]=[];
 try {
  await new Promise<void>((resolve,reject)=>{const p=spawn(mediaTool('ffmpeg'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=0.2','-c:v','libx264','-pix_fmt','yuv420p',file]);p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error('fixture failed')));});
  const p=newProject();const background={src:`assets/${name}`,name,kind:'video' as const,width:640,height:360,duration:.2};
  p.tracks=[{id:'t',title:'t',artist:'',focus:{x:.5,y:.5},audio:{src:'demo/track-01.wav',kind:'audio',name:'a',duration:1},background}];
  const prep=()=>prepareVideoFrames(p,'http://127.0.0.1:1',new AbortController().signal,()=>{},2);
  const first=await prep(),cache=Object.values(first.caches)[0],folder=path.join(frameCacheRoot,cache.baseSrc.split('/').at(-1)!);created.push(folder);
  assert.equal(first.records[0].frames,6);assert.equal(first.records[0].reused,false);assert.equal(cache.width,640);assert.equal(cache.height,360);assert.ok(Math.abs(cache.timestamps[1]-1/30)<1e-6);
  const png=await fs.readFile(path.join(folder,'00000000.png'));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),360);
  const second=await prep();assert.equal(second.records[0].reused,true);assert.equal(second.records[0].bytes,first.records[0].bytes);
  await fs.rm(path.join(folder,'00000003.png'));assert.equal((await prep()).records[0].reused,false);
  await fs.writeFile(path.join(folder,'00000003.png'),Buffer.alloc(128));assert.equal((await prep()).records[0].reused,false);
  const before=new Set(await fs.readdir(frameCacheRoot));await fs.utimes(file,new Date(),new Date(Date.now()+2000));
  const controller=new AbortController();await assert.rejects(prepareVideoFrames(p,'http://127.0.0.1:1',controller.signal,message=>{if(message.includes('帧'))controller.abort();}),/abort/i);
  const after=await fs.readdir(frameCacheRoot);assert.deepEqual(after.filter(n=>!before.has(n)),[]);
 } finally {await fs.rm(file,{force:true});for(const folder of created)await fs.rm(folder,{recursive:true,force:true});}
});
