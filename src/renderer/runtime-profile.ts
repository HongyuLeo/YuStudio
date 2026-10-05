import os from 'node:os';
import {performance} from 'node:perf_hooks';
import type {openBrowser} from '@remotion/renderer';
type Browser=Awaited<ReturnType<typeof openBrowser>>;
type Counter={calls:number;totalMs:number;maxMs:number};
export type RuntimeProfile={scope:string;wallMs:number;availableMemoryMinMiB:number;nodeRssMaxMiB:number;capture:Counter;browserCommands:Counter;note:string};
export function attachRuntimeProfiler(browser:Browser) {
  let scope:RuntimeProfile|undefined,start=0;
  const restores:(()=>void)[]=[];
  const memory=()=>{if(scope){scope.availableMemoryMinMiB=Math.min(scope.availableMemoryMinMiB,Math.round(os.freemem()/1024**2));scope.nodeRssMaxMiB=Math.max(scope.nodeRssMaxMiB,Math.round(process.memoryUsage().rss/1024**2));}};
  const timer=setInterval(memory,1000);timer.unref();
  const original=browser.newPage;
  browser.newPage=async function(options){
    const page=await original.call(this,options),client=page._client(),send=client.send;
    // Adapter for the pinned renderer's CDP client. No browser protocol data,
    // assets or request arguments are recorded; only elapsed command times.
    client.send=async function(this:typeof client,...args:Parameters<typeof send>){
      const current=scope,method=args[0],counter=method==='Page.captureScreenshot'?current?.capture:method==='Runtime.callFunctionOn' || method==='Runtime.evaluate'?current?.browserCommands:undefined;
      if(!counter)return send.apply(this,args);
      const before=performance.now();
      try{return await send.apply(this,args);}finally{const ms=performance.now()-before;counter.calls++;counter.totalMs+=ms;counter.maxMs=Math.max(counter.maxMs,ms);}
    } as typeof send;
    restores.push(()=>{client.send=send;});return page;
  };
  return {
    begin(label:string){start=performance.now();scope={scope:label,wallMs:0,availableMemoryMinMiB:Math.round(os.freemem()/1024**2),nodeRssMaxMiB:0,capture:{calls:0,totalMs:0,maxMs:0},browserCommands:{calls:0,totalMs:0,maxMs:0},note:'截图耗时包括 Chromium 合成、读回、图片压缩及协议传输等待；浏览器命令含脚本与就绪等待，不等于纯 React 耗时。各页面并行，累计耗时会重叠，不能换算为占用率。可用内存为系统值；Node RSS 不包含 Chromium/FFmpeg。'};memory();},
    end(){if(!scope)return undefined;memory();scope.wallMs=performance.now()-start;const result=scope;scope=undefined;return result;},
    snapshot(){if(!scope)return undefined;memory();scope.wallMs=performance.now()-start;return {...scope,capture:{...scope.capture},browserCommands:{...scope.browserCommands}};},
    dispose(){clearInterval(timer);browser.newPage=original;for(const restore of restores)restore();},
  };
}
