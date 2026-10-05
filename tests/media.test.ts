import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runTool, probe} from '../src/server/media';
import {createStudioServer} from '../src/server/index';
import {newProject} from '../src/project/model';
import {assetsRoot} from '../src/server/paths';
import {inspectBackgrounds} from '../src/renderer/diagnostics';
test('real media import: five audio formats, metadata, three images, loop video, project round trip, and bad input', {timeout:120000}, async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nocturne-media-'));
  const {server,port}=await createStudioServer(0,true), origin=`http://127.0.0.1:${port}`;
  const created: string[]=[];
  async function upload(file:string,kind:string){const form=new FormData();form.set('kind',kind);form.append('files',new File([new Uint8Array(await fs.readFile(file)).buffer],path.basename(file)));const r=await fetch(`${origin}/api/import`,{method:'POST',body:form});assert.equal(r.status,200);return (await r.json()).results[0];}
  try {
    const tracks=[];
    for(const ext of ['wav','mp3','flac','aac','m4a']){
      const file=path.join(folder,`测试歌曲.${ext}`);
      const args=['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1.25','-ar','48000','-metadata','title=雪落无声','-metadata','artist=Original Test',file];
      await runTool('ffmpeg',args);
      const r=await upload(file,'audio');assert.ok(!r.error,r.error);assert.equal(r.asset.kind,'audio');assert.ok(r.asset.duration>=1.2&&r.asset.duration<1.4);assert.ok(r.track.title.length>0);
      if(ext!=='aac'){assert.equal(r.track.title,'雪落无声');assert.equal(r.track.artist,'Original Test');}
      assert.equal(r.asset.name,`测试歌曲.${ext}`);tracks.push(r.track);created.push(r.asset.src.slice(7));
    }
    for(const ext of ['jpg','png','webp']){
      const file=path.join(folder,`图片.${ext}`);await runTool('ffmpeg',['-y','-v','error','-i',path.resolve('public/demo/scene-1.png'),'-vf','scale=800:-2','-frames:v','1',file]);
      const r=await upload(file,'background');assert.ok(!r.error,r.error);assert.equal(r.asset.kind,'image');assert.equal(r.asset.width,800);created.push(r.asset.src.slice(7));tracks[0].background=r.asset;
    }
    for(const ext of ['mp4','mov','webm']){
      const file=path.join(folder,`动态.${ext}`);await runTool('ffmpeg',['-y','-v','error','-loop','1','-i',path.resolve('public/demo/scene-3.png'),'-vf','scale=640:-2','-t','2','-r','30','-an','-c:v',ext==='webm'?'libvpx-vp9':'libx264','-pix_fmt','yuv420p',file]);
      const r=await upload(file,'background');assert.ok(!r.error,r.error);assert.equal(r.asset.kind,'video');assert.equal(r.asset.loopPrepared,true);assert.ok(r.asset.duration>1.4&&r.asset.duration<1.7);
      const meta=await probe(path.join(assetsRoot,r.asset.src.slice(7)));assert.ok(meta.streams.every(s=>s.codec_type!=='audio'));
      created.push(r.asset.src.slice(7),r.asset.thumbnail.slice(7));tracks[1].background=r.asset;
      const range=await fetch(origin+'/media/'+r.asset.src.slice(7),{headers:{Origin:'http://localhost:3000',Range:'bytes=0-15'}});
      assert.equal(range.status,206);assert.equal(range.headers.get('access-control-allow-origin'),'http://localhost:3000');assert.match(range.headers.get('content-range')!,/^bytes 0-15\//);assert.equal((await range.arrayBuffer()).byteLength,16);
      const outside=await fetch(origin+'/media/'+r.asset.src.slice(7),{headers:{Origin:'https://example.com',Range:'bytes=0-15'}});
      assert.equal(outside.headers.get('access-control-allow-origin'),null);
    }
    const project={...newProject(),tracks};
    const backgrounds=await inspectBackgrounds(project),actualVideo=backgrounds.find(b=>b.kind==='video');
    assert.equal(actualVideo?.codec,'h264');assert.equal(actualVideo?.width,640);assert.equal(actualVideo?.frameRate,'30/1');assert.ok(actualVideo?.fileBytes);assert.ok(!actualVideo?.error);
    const duplicate=await inspectBackgrounds({...project,tracks:[tracks[1],{...tracks[1],id:'duplicate-asset'}]});assert.equal(duplicate.length,1);
    const save=await fetch(`${origin}/api/project/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(project)});assert.equal(save.status,200);const url=(await save.json()).url;
    const saved=await (await fetch(origin+url)).json();assert.deepEqual(saved,project);
    const opened=await fetch(`${origin}/api/project/open`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(saved)});assert.equal(opened.status,200);
    const invalid=await fetch(`${origin}/api/render`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(project)});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/背景/);
    const corrupt=path.join(folder,'bad.mp3');await fs.writeFile(corrupt,'broken');const bad=await upload(corrupt,'audio');assert.ok(bad.error);
    const crossSite=await fetch(`${origin}/api/project/save`,{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'});assert.equal(crossSite.status,403);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await fs.rm(folder,{recursive:true,force:true});
    await Promise.all(created.map(f=>fs.rm(path.join(assetsRoot,f),{force:true})));
  }
});
