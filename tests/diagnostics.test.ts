import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graphicsInfo, readVideoObservation, SpeedWindow} from '../src/renderer/diagnostics';
test('reader diagnostics require an actual frame or a reported compatibility fallback',()=>{
  assert.deepEqual(readVideoObservation('NOCTURNE_VIDEO:{"src":"http://localhost:4317/media/a.mp4","backend":"webcodecs"}'),{src:'http://localhost:4317/media/a.mp4',backend:'webcodecs',reason:undefined});
  assert.equal(readVideoObservation('NOCTURNE_VIDEO:{"src":"x","backend":"ffmpeg","reason":"Cannot decode"}')?.reason,'Cannot decode');
  assert.equal(readVideoObservation('NOCTURNE_VIDEO:{"src":"x","backend":"nvenc"}'),null);
  assert.equal(readVideoObservation('NOCTURNE_VIDEO:invalid'),null);
  assert.equal(readVideoObservation('other video warning'),null);
});
test('actual software rendering is not mistaken for NVENC or requested ANGLE',()=>{
  const software=graphicsInfo({gpu:{devices:[{vendorString:'NVIDIA',deviceString:'RTX 4090'}],auxAttributes:{glRenderer:'ANGLE (Google, SwiftShader Device)'},featureStatus:{gpu_compositing:'disabled_software'}}});
  assert.equal(software.software,true);assert.match(software.device,/4090/);
  const hardware=graphicsInfo({gpu:{devices:[{deviceString:'RTX 4090'}],auxAttributes:{glRenderer:'ANGLE (NVIDIA, RTX 4090 Direct3D11)'},featureStatus:{gpu_compositing:'enabled'}}});
  assert.equal(hardware.software,false);
  assert.equal(graphicsInfo({}).software,undefined);
});
test('recent rates respond to a stall while cumulative counts keep increasing',()=>{
  const w=new SpeedWindow(10000);assert.equal(w.update(0,0,0).rendered,null);
  assert.deepEqual(w.update(5000,100,80),{rendered:20,encoded:16});
  w.update(10000,200,160);
  assert.deepEqual(w.update(20000,200,160),{rendered:0,encoded:0});
  assert.deepEqual(w.update(25000,300,240),{rendered:6.7,encoded:5.3});
  const next=new SpeedWindow();assert.equal(next.update(100000,0,0).rendered,null);
});
