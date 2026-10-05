import fs from 'node:fs/promises';
import os from 'node:os';
// This QA host restricts interface enumeration. Rendering only needs known local loopback.
if (process.env.NOCTURNE_QA_SANDBOX === '1') os.networkInterfaces = () => ({lo: [{address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8'}]});
import path from 'node:path';
import {createStudioServer} from '../src/server/index';
import {startRender} from '../src/renderer/pipeline';
import {projectSchema} from '../src/project/model';
import {outputRoot} from '../src/server/paths';
const project=projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json','utf8')));
const {server,port}=await createStudioServer(0,true);
try {
  const job=await startRender(project,`http://127.0.0.1:${port}`);
  let previous='';
  while(!['done','error','cancelled'].includes(job.state)) {
    const status=`${job.state}: ${Math.floor(job.progress*20)*5}% · ${job.message}`;
    if(status!==previous){console.log(status);previous=status;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(job.state!=='done')throw new Error(job.message);
  await fs.mkdir('deliverables',{recursive:true});
  for(const f of job.files)await fs.copyFile(path.join(outputRoot,job.id,f.name),path.resolve('deliverables',f.name));
  console.log('Demo exported to deliverables/');
} finally {server.close();}
