import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),renderer=path.dirname(require.resolve('@remotion/renderer'));
test('old proxy rejects a compositor protocol header with the exact reported 114 101 109 error',async()=>{
 const compositor=require(path.join(renderer,'compositor/compositor.js')),assets=require(path.join(renderer,'assets/download-and-map-assets-to-file.js'));
 const oldMake=compositor.makeLazyCompositor,oldDownload=assets.downloadAsset;
 compositor.makeLazyCompositor=()=>({executeCommand:async()=>Buffer.from('remotion_buffer:bad-payload'),shutDownOrKill:async()=>{}});assets.downloadAsset=async()=>'/fixture.mp4';
 try {
  const {startOffthreadVideoServer}=require(path.join(renderer,'offthread-video-server.js'));
  const server=startOffthreadVideoServer({downloadMap:{},logLevel:'silent',indent:false,offthreadVideoCacheSizeInBytes:512*1024*1024,binariesDirectory:null,offthreadVideoThreads:2});
  let status=0,body='';const req=Object.assign(new EventEmitter(),{url:'/proxy?src=http://localhost/v.mp4&time=1&transparent=false&toneMapped=true',method:'GET',headers:{}});
  await new Promise<void>(resolve=>server.listener(req,{headersSent:false,setHeader:()=>{},writeHead:(code:number)=>{status=code;},write:(data:string)=>{body+=data;},end:resolve}));
  assert.equal(status,500);assert.match(body,/Unknown file type: 114 101 109/);await server.close();
 }finally{compositor.makeLazyCompositor=oldMake;assets.downloadAsset=oldDownload;}
});
