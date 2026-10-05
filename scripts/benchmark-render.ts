import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ensureBrowser, openBrowser, selectComposition, renderStill, renderMedia} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {forPlayback} from '../src/renderer/pipeline';
import {projectSchema} from '../src/project/model';
if (process.env.NOCTURNE_QA_SANDBOX === '1') os.networkInterfaces = () => ({lo: [{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const label = process.argv[2] || 'current';
const presets = process.argv.includes('--reverse') ? ['embers','snow'] as const : ['snow','embers'] as const;
const serveUrl = path.resolve(process.argv[3] || 'remotion-dist');
const {server, port} = await createStudioServer(0, true);
const status = (process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'})); if (!('path' in status)) throw Error('No browser');
const browser = await openBrowser('chrome', {browserExecutable:status.path, chromiumOptions:{gl:'swiftshader'},logLevel:'warn'});
const project=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
project.fps=60; project.render.resolution='4k'; project.tracks=project.tracks.slice(0,1); project.tracks[0].artist='';
const results=[];
try {
  for (const preset of presets) {
    project.tracks[0].atmosphere={preset,amount:.75};
    const inputProps={project:forPlayback(project,`http://127.0.0.1:${port}`),orientation:'landscape'};
    const opts={serveUrl,inputProps,puppeteerInstance:browser,chromiumOptions:{gl:'swiftshader' as const},logLevel:'warn' as const};
    const composition=await selectComposition({...opts,id:'Landscape'});
    await renderStill({...opts,composition,frame:180,imageFormat:'png',output:path.resolve(`deliverables/${label}-${preset}-4k.png`)});
    let latest: unknown;
    const start=Date.now();
    const output=await renderMedia({...opts,composition,frameRange:[180,239],codec:'h264',hardwareAcceleration:'disable',x264Preset:'veryfast',crf:18,concurrency:4,outputLocation:path.resolve(`deliverables/${label}-${preset}-4k.mp4`),onProgress:p=>{latest=p;}, offthreadVideoThreads:4,offthreadVideoCacheSizeInBytes:512*1024*1024});
    const result={preset,wallSeconds:(Date.now()-start)/1000,progress:latest,slowestFrames:output.slowestFrames};results.push(result);console.log(JSON.stringify({label,...result}));
  }
  await fs.writeFile(`deliverables/benchmark-${label}.json`, JSON.stringify({label,host:'Linux CPU/SwiftShader; no NVIDIA GPU',frames:[180,239],width:3840,height:2160,fps:60,concurrency:4,results},null,2));
} finally {await browser.close({silent:true});server.close();}
