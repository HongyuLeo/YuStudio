import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {getBundle, forPlayback} from '../src/renderer/pipeline';
import {projectSchema} from '../src/project/model';
if (process.env.NOCTURNE_QA_SANDBOX === '1') os.networkInterfaces = () => ({lo: [{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server, port} = await createStudioServer(0, true);
try {
  const project = projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json', 'utf8')));
  const browser = (process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));
  if (!('path' in browser)) throw new Error('Browser missing');
  const opts = {serveUrl:await getBundle(), browserExecutable:browser.path, chromiumOptions:{gl:'angle' as const}, logLevel:'warn' as const};
  for (const orientation of ['landscape','portrait'] as const) {
    const inputProps = {project:forPlayback(project,`http://127.0.0.1:${port}`),orientation};
    const composition = await selectComposition({...opts,id:orientation === 'landscape' ? 'Landscape':'Portrait',inputProps});
    for (const [name, frame] of [['snow',90],['fireflies',300],['embers',945]] as const) {
      await renderStill({...opts,composition,inputProps,frame,imageFormat:'png',output:path.resolve(`deliverables/${orientation}-${name}-v1.1.png`)});
    }
    // A neutral test card exposes any full-frame or lower-half darkening.
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="#d9e1e8" d="M0 0h1920v1080H0z"/></svg>').render().asPng();
    const p = {...project,presentation:{showPlaylist:false,showProgress:false},tracks:[{...project.tracks[0],atmosphere:{preset:'none' as const,amount:0},background:{kind:'image' as const,src:`data:image/png;base64,${png.toString('base64')}`,name:'neutral-card',width:1920,height:1080}}]};
    const testProps = {project:p,orientation};
    const testComposition = await selectComposition({...opts,id:composition.id,inputProps:testProps});
    await renderStill({...opts,composition:testComposition,inputProps:testProps,frame:90,imageFormat:'png',output:path.resolve(`deliverables/brightness-${orientation}-qa.png`)});
  }
  console.log('PASS: snow/fireflies/embers, both orientations, neutral brightness check frames.');
} finally {server.close();}
