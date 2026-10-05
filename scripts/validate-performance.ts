import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ensureBrowser} from '@remotion/renderer';
import {createStudioServer} from '../src/server/index';
import {machineInfo} from '../src/renderer/performance';
import {outputRoot} from '../src/server/paths';
import {projectSchema} from '../src/project/model';
import {probe} from '../src/server/media';
if (process.env.NOCTURNE_QA_SANDBOX === '1') os.networkInterfaces = () => ({lo: [{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const {server, port} = await createStudioServer(0, true);
const origin = `http://127.0.0.1:${port}`;
const browserStatus = (process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel: 'warn'}));
if (!('path' in browserStatus)) throw new Error('Browser unavailable');
process.env.REMOTION_BROWSER_EXECUTABLE = browserStatus.path;
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({executablePath: browserStatus.path, headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1500, height: 1100}, acceptDownloads: true});
const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
async function post(url: string, value: unknown) {const r = await fetch(origin + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)}); assert.equal(r.status, 200, await r.clone().text()); return r.json();}
async function waitJob(id: string) {
  const until = Date.now() + 180000;
  while (Date.now() < until) {const j = await fetch(`${origin}/api/render/${id}`).then(r => r.json()); if (!['preparing', 'rendering'].includes(j.state)) return j; await new Promise(r => setTimeout(r, 300));}
  throw new Error('Render timeout');
}
try {
  await page.goto(origin); await page.getByRole('button', {name: '全力输出', exact: true}).waitFor();
  await page.waitForFunction(() => !!localStorage.getItem('nocturne.project.v1'));
  await page.getByRole('button', {name: '全力输出', exact: true}).click();
  const max = machineInfo().maxConcurrency;
  assert.equal(await page.getByLabel('渲染并发', {exact: true}).inputValue(), String(max));
  assert.equal(await page.getByLabel('编码设备', {exact: true}).inputValue(), 'nvenc');
  assert.equal(await page.getByLabel('视频解码线程',{exact:true}).inputValue(),'2');
  assert.equal(await page.getByLabel('视频背景读取',{exact:true}).inputValue(),'cached');
  assert.equal(await page.getByLabel('视频缓存 / MB', {exact: true}).inputValue(), '4096');
  await page.getByLabel('渲染并发', {exact: true}).fill(String(Math.min(24, max)));
  await page.getByLabel('视频缓存 / MB', {exact: true}).fill('2048');
  await page.getByLabel('视频解码线程', {exact: true}).fill('8');
  await page.getByLabel('码率 / Mbps（0 自动）', {exact: true}).fill('45');
  await page.getByLabel('编码档位', {exact: true}).selectOption('quality');
  await page.getByLabel('视频背景读取',{exact:true}).selectOption('cached');
  const download = page.waitForEvent('download'); await page.getByRole('button', {name:'保存项目', exact:true}).click();
  const saved = await download; const savedPath = await saved.path();
  const p = projectSchema.parse(JSON.parse(await fs.readFile(savedPath, 'utf8')));
  assert.equal(p.render.cacheMiB, 2048); assert.equal(p.render.bitrateMbps, 45); assert.equal(p.render.encoder, 'nvenc');
  assert.equal(p.render.videoReader,'cached');
  await page.reload(); await page.getByLabel('视频缓存 / MB', {exact:true}).waitFor();
  assert.equal(await page.getByLabel('视频缓存 / MB', {exact:true}).inputValue(), '2048');
  assert.equal(await page.getByLabel('视频背景读取',{exact:true}).inputValue(),'cached');
  await page.getByRole('button', {name:'全力输出', exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'deliverables/performance-v1.2.png', fullPage: true});
  console.log('PASS: full-power preset, numeric controls, save/download and reload, no frontend error. Host maximum:', max);
  const demo = projectSchema.parse(JSON.parse(await fs.readFile('public/demo/project.json', 'utf8')));
  demo.tracks = [{...demo.tracks[0], audio: {...demo.tracks[0].audio, duration: .6}}];
  demo.render = {...demo.render, landscape:true,portrait:false,resolution:'1080p',concurrency:Math.min(4,max),encoder:'cpu',speed:'fast',cacheMiB:512,videoThreads:4,gl:'swiftshader'};
  // Run the real UI -> HTTP -> rendering -> completed job chain.
  await page.evaluate((value: unknown) => localStorage.setItem('nocturne.project.v1', JSON.stringify(value)), demo);
  await page.reload(); await page.getByLabel('编码设备', {exact: true}).waitFor();
  await page.getByRole('button', {name:'生成音乐影像', exact:true}).click();
  await page.getByText('作品已就绪', {exact:true}).waitFor({timeout:180000});
  assert.ok(await page.getByText(/libx264 · .* 并发/).count());
  console.log('PASS: CPU real UI export and actual encoder/fps display.');
  const jobs = await fs.readdir(outputRoot); const exported = [];
  for (const id of jobs) {const report = await fs.readFile(path.join(outputRoot,id,'performance.json'),'utf8').catch(() => null); if (report) exported.push({id,report:JSON.parse(report)});}
  const cpu = exported.find(x => x.report.encoder === 'libx264'); assert.ok(cpu);
  const clip = path.join(outputRoot,cpu.id,'YouTube_1080p_Landscape.mp4');
  const m = await probe(clip) as unknown as {streams: {codec_type: string; codec_name?: string; sample_rate?: string}[]}; assert.equal(m.streams.find((s: {codec_type:string}) => s.codec_type === 'video')?.codec_name,'h264');
  assert.equal(m.streams.find((s: {codec_type:string}) => s.codec_type === 'audio')?.sample_rate,'48000');
  await fs.copyFile(clip,'deliverables/performance-cpu-qa.mp4');
  demo.render.encoder = 'auto'; const autoStart = await post('/api/render',demo); const auto = await waitJob(autoStart.id);
  assert.equal(auto.state,'done',auto.message); assert.ok(auto.performance.fallback); assert.equal(auto.performance.encoder,'libx264');
  assert.ok(auto.performance.renderedFps > 0); console.log('PASS: actual unavailable NVENC probe, explicit CPU fallback, completed output.');
  demo.render.encoder = 'nvenc'; const strictStart = await post('/api/render',demo); const strict = await waitJob(strictStart.id);
  assert.equal(strict.state,'error'); assert.match(strict.message,/强制 NVIDIA NVENC/); assert.equal(strict.files.length,0);
  assert.ok(!(await fs.readdir(path.join(outputRoot,strict.id))).some(f=>f.endsWith('.mp4')));
  console.log('PASS: forced NVENC fails explicitly with no GPU, no MP4 or partial file.');
  demo.render.encoder='cpu'; demo.render.codec='h265'; demo.render.bitrateMbps=12;
  const hevcStart = await post('/api/render',demo); const hevc = await waitJob(hevcStart.id); assert.equal(hevc.state,'done',hevc.message); assert.equal(hevc.performance.encoder,'libx265');
  console.log('PASS: H.265 CPU export with explicit bitrate and actual encoder.');
  const cache=await fetch(`${origin}/api/frame-cache`).then(r=>r.json());
  if(cache.backgrounds){await page.getByRole('button',{name:'清理背景缓存',exact:true}).click();await page.getByText('已清理，下次生成会重新准备。',{exact:true}).waitFor();}
  assert.equal((await fetch(`${origin}/api/frame-cache`).then(r=>r.json())).backgrounds,0);
  assert.deepEqual(errors,[]);
  console.log('ALL PERFORMANCE QA PASSED. GPU encoding success requires an NVIDIA host and is not claimed here.');
} finally {await browser.close(); server.close();}
