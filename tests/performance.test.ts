import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {RenderInternals} from '@remotion/renderer';
import {nvencProbeFrame} from '../src/renderer/nvenc-probe-frame';
import {newProject, projectSchema} from '../src/project/model';
import {encodingOptions, encoderArguments, fullPowerSettings, performanceSettings, videoBitrate} from '../src/project/performance';
import {chooseEncoder, machineInfo, validatePerformance} from '../src/renderer/performance';
test('old projects remain readable, custom concurrency has no fixed 16 cap, runtime reports real framework maximum', () => {
  const p = newProject(); p.render.concurrency = 32;
  assert.equal(projectSchema.parse(p).render.concurrency, 32);
  delete p.render.encoder; delete p.render.cacheMiB;
  assert.equal(performanceSettings(projectSchema.parse(p)).encoder, 'auto');
  assert.equal(performanceSettings(projectSchema.parse(p)).videoReader,'cached');
  delete p.render.readerVersion;p.render.videoReader='auto';assert.equal(performanceSettings(projectSchema.parse(p)).videoReader,'cached');
  p.render.readerVersion=2;assert.equal(performanceSettings(projectSchema.parse(p)).videoReader,'auto');
  p.render.videoReader='legacy';assert.equal(performanceSettings(projectSchema.parse(p)).videoReader,'cached');
  const max = machineInfo().maxConcurrency; p.render.concurrency = max; validatePerformance(p);
  p.render.concurrency = max + 1; assert.throws(() => validatePerformance(p), new RegExp(String(max)));
  assert.equal(fullPowerSettings({maxConcurrency: 32, memoryGiB: 64, cpu: 'test'}).concurrency, 32);
  assert.equal(fullPowerSettings({maxConcurrency:32,memoryGiB:32,cpu:'test'}).videoThreads,2);
});
test('NVENC uses required acceleration without CRF or CPU preset; bitrate respects resolution and manual override', () => {
  const p = newProject();
  const gpu = encodingOptions(p, 'landscape', true);
  assert.equal(gpu.hardwareAcceleration, 'required'); assert.equal(gpu.videoBitrate, '60M');
  assert.ok(!('crf' in gpu)); assert.equal(gpu.x264Preset, null);
  assert.equal(videoBitrate(p, 'portrait'), '16M');
  p.fps = 60; assert.equal(videoBitrate(p, 'landscape'), '90M');
  p.render.bitrateMbps = 45; assert.equal(videoBitrate(p, 'portrait'), '45M');
  const cpu = encodingOptions(p, 'landscape', false); assert.ok(!('crf' in cpu));
  delete p.render.bitrateMbps; const crf = encodingOptions(p, 'landscape', false); assert.ok('crf' in crf); assert.equal(crf.crf, 18);
});
test('GPU speed preset reaches video encode only, forced GPU never accepts CPU arguments', () => {
  assert.deepEqual(encoderArguments(['-c:v', 'h264_nvenc', 'out.mp4'], true, 'fast'), ['-c:v', 'h264_nvenc', '-preset', 'p1', 'out.mp4']);
  assert.deepEqual(encoderArguments(['-c:v', 'hevc_nvenc', 'out.mp4'], true, 'quality'), ['-c:v', 'hevc_nvenc', '-preset', 'p7', 'out.mp4']);
  assert.deepEqual(encoderArguments(['-c:v', 'copy', 'out.mp4'], true, 'fast'), ['-c:v', 'copy', 'out.mp4']);
  assert.throws(() => encoderArguments(['-c:v', 'libx264', 'out.mp4'], true, 'fast'), /NVENC/);
  assert.deepEqual(encoderArguments(['-c:v', 'libx265', 'out.mp4'], false, 'fast'), ['-c:v', 'libx265', '-preset', 'veryfast', 'out.mp4']);
  const p = newProject(); p.render.codec = 'h265'; assert.equal(encodingOptions(p, 'landscape', false).x264Preset, null);
});
test('a failed actual NVENC probe is explicit in auto and fatal in forced mode', async () => {
  const old = process.env.REMOTION_BINARIES_DIRECTORY;
  process.env.REMOTION_BINARIES_DIRECTORY = '/nocturne-qa-missing-binaries';
  try {
    const p = newProject(); p.render.encoder = 'auto';
    const auto = await chooseEncoder(p); assert.equal(auto.name, 'libx264'); assert.equal(auto.hardware, false); assert.match(auto.fallback!, /CPU/);
    p.render.encoder = 'nvenc'; await assert.rejects(chooseEncoder(p), /强制 NVIDIA NVENC/);
    p.render.encoder = 'cpu'; assert.equal((await chooseEncoder(p)).name, 'libx264');
  } finally {if (old === undefined) delete process.env.REMOTION_BINARIES_DIRECTORY; else process.env.REMOTION_BINARIES_DIRECTORY = old;}
});
test('NVENC sends a standard 1080p frame for both codecs, not an unsupported tiny frame', {skip: process.platform === 'win32'}, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-nvenc-probe-'));
  const executable = path.join(folder, 'probe-ffmpeg');
  await fs.writeFile(executable, `#!/usr/bin/env node
const chunks = [];
process.stdin.on('data', b => chunks.push(b));
process.stdin.on('end', () => {
  const png = Buffer.concat(chunks);
  const encoder = process.argv[process.argv.indexOf('-c:v') + 1];
  const preset = process.argv[process.argv.indexOf('-preset') + 1];
  if (png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080) {console.error('Frame Dimension less than the minimum supported value'); process.exit(1);}
  if (!['h264_nvenc', 'hevc_nvenc'].includes(encoder) || !['p1', 'p4', 'p7'].includes(preset)) process.exit(2);
});
`); await fs.chmod(executable, 0o755);
  const original = RenderInternals.getExecutablePath;
  RenderInternals.getExecutablePath = () => executable;
  try {
    const p = newProject(); p.render.encoder = 'nvenc'; p.render.speed = 'fast';
    assert.deepEqual(await chooseEncoder(p), {hardware: true, name: 'h264_nvenc'});
    p.render.codec = 'h265'; p.render.speed = 'quality';
    assert.deepEqual(await chooseEncoder(p), {hardware: true, name: 'hevc_nvenc'});
  } finally {RenderInternals.getExecutablePath = original; await fs.rm(folder, {recursive: true, force: true});}
});
test('the same bundled FFmpeg can decode and encode the new 1080p detection frame', async () => {
  const executable = RenderInternals.getExecutablePath({type:'ffmpeg',binariesDirectory:process.env.REMOTION_BINARIES_DIRECTORY ?? null,indent:false,logLevel:'warn'});
  assert.equal(nvencProbeFrame.readUInt32BE(16),1920); assert.equal(nvencProbeFrame.readUInt32BE(20),1080);
  await new Promise<void>((resolve,reject) => {
    const child = spawn(executable,['-hide_banner','-v','error','-f','image2pipe','-vcodec','png','-r','30','-i','pipe:0','-frames:v','1','-pix_fmt','yuv420p','-c:v','libx264','-preset','veryfast','-f','null','-'],{cwd:path.dirname(executable),windowsHide:true,stdio:['pipe','ignore','pipe']});
    let detail = ''; child.stderr.on('data',data=>{detail+=String(data);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(detail)));child.stdin.on('error',()=>{});child.stdin.end(nvencProbeFrame);
  });
});
