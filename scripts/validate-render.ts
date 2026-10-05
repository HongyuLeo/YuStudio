import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ensureBrowser, selectComposition, renderStill, renderMedia} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {forPlayback, getBundle} from '../src/renderer/pipeline';
import {projectSchema} from '../src/project/model';
import {probe} from '../src/server/media';
if (process.env.NOCTURNE_QA_SANDBOX === '1') os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server,port}=await createStudioServer(0,true);
const project=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
try {
 const serveUrl=await getBundle(), status=(process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));if(!('path' in status))throw new Error('Browser unavailable');
 const opts={serveUrl,browserExecutable:status.path,chromiumOptions:{gl:'angle' as const},logLevel:'warn' as const,timeoutInMilliseconds:90000};
 for(const resolution of ['1440p','4k'] as const){
  const p={...project,render:{...project.render,resolution}};
  const inputProps={project:forPlayback(p,`http://127.0.0.1:${port}`),orientation:'landscape' as const};
  const composition=await selectComposition({...opts,id:'Landscape',inputProps});
  await renderStill({...opts,composition,inputProps,frame:90,output:path.resolve(`deliverables/${resolution}-frame.png`),imageFormat:'png'});
  if(resolution==='4k'){
   await renderMedia({...opts,composition,inputProps,codec:'h264',audioCodec:'aac',sampleRate:48000,concurrency:2,frameRange:[90,104],outputLocation:path.resolve('deliverables/4k-validation.mp4'),crf:18});
   console.log('4K sample:',JSON.stringify(await probe(path.resolve('deliverables/4k-validation.mp4'))).slice(0,180));
  }
 }
 const p={...project,fps:60 as const,tracks:[{...project.tracks[2],audio:{...project.tracks[2].audio,duration:2.5}}],render:{...project.render,resolution:'1080p' as const}};
 const inputProps={project:forPlayback(p,`http://127.0.0.1:${port}`),orientation:'landscape' as const};
 const composition=await selectComposition({...opts,id:'Landscape',inputProps});
 await renderMedia({...opts,composition,inputProps,codec:'h265',audioCodec:'aac',sampleRate:48000,concurrency:2,outputLocation:path.resolve('deliverables/h265-60fps-validation.mp4'),crf:18});
 const m=await probe(path.resolve('deliverables/h265-60fps-validation.mp4'));
 console.log('PASS: 1440p and 4K stills; 4K H.264/AAC clip; 60fps H.265/AAC loop-video composition. Duration:',m.format.duration);
} finally {server.close();}
