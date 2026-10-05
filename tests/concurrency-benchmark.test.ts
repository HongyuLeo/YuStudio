import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model';
import {benchmarkWindows,concurrencyCandidates,selectFastestConcurrency,ThroughputClock,type BenchmarkSample} from '../src/renderer/concurrency-benchmark';
import {encodingFrameCount} from '../src/renderer/diagnostics';
test('autotune includes the machine maximum and custom value without a fixed cap',()=>{
  assert.deepEqual(concurrencyCandidates(32,12),[4,8,12,16,32]);
  assert.deepEqual(concurrencyCandidates(64,48),[4,8,16,32,48,64]);
  assert.deepEqual(concurrencyCandidates(2,1),[1,2]);
});
test('sample ranges use original absolute frames, largest background and transition, clamped for short projects',()=>{
  const p=newProject();
  const track=(id:string,duration:number,width:number)=>({id,title:id,artist:'',audio:{src:`demo/${id}.wav`,name:id,kind:'audio' as const,duration},background:{src:`demo/${id}.mp4`,name:id,kind:'video' as const,width,height:width*9/16},focus:{x:.5,y:.5}});
  p.fps=60;p.tracks=[track('a',100,720),track('b',100,3840)];
  const windows=benchmarkWindows(p,32);assert.equal(windows.length,2);assert.equal(windows[0].start,6120);assert.equal(windows[1].start,5912);
  assert.equal(windows[0].end-windows[0].start+1,192);
  p.tracks=[track('short',.1,3840)];assert.deepEqual(benchmarkWindows(p,32),[{start:0,end:5,label:'最大背景 / 场景中段'}]);
});
test('whole-output throughput chooses a faster lower concurrency; failed or incomplete candidates cannot win',()=>{
  const windows=[{start:100,end:291,label:'main'},{start:500,end:691,label:'transition'}];
  const samples:BenchmarkSample[]=[4,8,16,32].flatMap(concurrency=>windows.map(window=>({concurrency,window,frames:192,wallMs:20000,measuredFrames:128,measuredMs:concurrency===8?8000:concurrency===4?10000:concurrency===16?9000:12000,fps:1})));
  assert.equal(selectFastestConcurrency(samples,[4,8,16,32],windows),8);
  const near=samples.map(s=>({...s,measuredMs:s.concurrency===4?8050:s.concurrency===8?8000:12000}));
  assert.equal(selectFastestConcurrency(near,[4,8,16,32],windows),4);
  samples.find(s=>s.concurrency===8)!.error='encoder failed';assert.equal(selectFastestConcurrency(samples,[4,8,16,32],windows),16);
  assert.throws(()=>selectFastestConcurrency([], [4,8],windows),/全部失败/);
});
test('warmup excluded, duplicate progress not counted, short clips use whole-output fallback',()=>{
  const clock=new ThroughputClock(64);clock.update(100,10);clock.update(5000,64);clock.update(6000,96);clock.update(7000,96);clock.update(9000,128);
  assert.deepEqual(clock.result(192,15000),{measuredFrames:64,measuredMs:4000,fps:16});
  assert.deepEqual(new ThroughputClock(64).result(6,2000),{measuredFrames:6,measuredMs:2000,fps:3});
});
test('restore parallel encoded frame counts from weighted progress without counting mux as extra encoding',()=>{
  assert.equal(encodingFrameCount({encodedFrames:800,stitchStage:'encoding'},2000,true),1000);
  assert.equal(encodingFrameCount({encodedFrames:1800,stitchStage:'muxing'},2000,true),2000);
  assert.equal(encodingFrameCount({encodedFrames:123,stitchStage:'encoding'},2000,false),123);
});
