import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Asset, Track} from '../project/model';
import {assetsRoot, mediaTool} from './paths';
export function runTool(tool: 'ffmpeg' | 'ffprobe', args: string[], timeoutMs = 30 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(mediaTool(tool), args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', ended = false;
    const timer = setTimeout(() => {child.kill(); reject(new Error(`${tool} 处理超时，请尝试更短的素材。`));}, timeoutMs);
    child.stdout.on('data', x => {stdout += x;});
    child.stderr.on('data', x => {stderr = (stderr + x).slice(-8000);});
    const done = () => {ended = true; clearTimeout(timer);};
    child.on('error', e => {if (!ended) {done(); reject(new Error(`无法启动 ${tool}。请重新安装依赖，或设置 ${tool.toUpperCase()}_PATH。${e.message}`));}});
    child.on('close', code => {if (!ended) {done(); code === 0 ? resolve(stdout) : reject(new Error(`${tool} 无法读取或处理素材：${stderr.slice(-1500)}`));}});
  });
}
export async function probe(file: string) {
  return JSON.parse(await runTool('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], 60000)) as {
    format: {duration?: string; tags?: Record<string, string>};
    streams: {codec_type: string; codec_name?:string; pix_fmt?:string;color_space?:string; avg_frame_rate?:string; bit_rate?:string; width?: number; height?: number; duration?: string; tags?: Record<string, string>}[];
  };
}
export async function importMedia(input: string, name: string, kind: 'audio' | 'background'): Promise<{asset: Asset; title?: string; artist?: string}> {
  const ext = path.extname(name).toLowerCase();
  const supported = kind === 'audio' ? ['.mp3', '.wav', '.flac', '.aac', '.m4a'] : ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm'];
  if (!supported.includes(ext)) throw new Error(`不支持这个文件格式：${ext}`);
  const original = await probe(input), id = randomUUID();
  const outputs: string[] = [];
  try {
    if (kind === 'audio') {
      const stream = original.streams.find(s => s.codec_type === 'audio');
      if (!stream) throw new Error('没有找到可播放的音频轨。');
      const out = path.join(assetsRoot, `${id}.m4a`); outputs.push(out);
      await runTool('ffmpeg', ['-y', '-v', 'error', '-i', input, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]);
      const duration = Number((await probe(out)).format.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('音频时长无效，或超过 24 小时。');
      const tags = {...original.format.tags, ...stream.tags};
      const tag = (key: string) => Object.entries(tags).find(([k]) => k.toLowerCase() === key)?.[1];
      return {asset: {src: `assets/${id}.m4a`, name, kind: 'audio', duration}, title: tag('title') || path.parse(name).name, artist: tag('artist') || tag('album_artist') || ''};
    }
    const video = original.streams.find(s => s.codec_type === 'video');
    if (!video?.width || !video.height) throw new Error('背景素材没有有效画面。');
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      const out = path.join(assetsRoot, `${id}${ext}`); outputs.push(out);
      // Decode and normalize orientation, including EXIF rotation. PNG is lossless.
      const normalized = path.join(assetsRoot, `${id}.png`); outputs.push(normalized);
      await runTool('ffmpeg', ['-y', '-v', 'error', '-i', input, '-frames:v', '1', normalized]);
      const meta = (await probe(normalized)).streams.find(s => s.codec_type === 'video')!;
      return {asset: {src: `assets/${id}.png`, name, kind: 'image', width: meta.width, height: meta.height}};
    }
    const duration = Number(original.format.duration ?? video.duration);
    if (!Number.isFinite(duration) || duration < .15 || duration > 600) throw new Error('背景视频需为 0.15 秒至 10 分钟的短视频。');
    const raw = path.join(assetsRoot, `${id}-raw.mp4`), out = path.join(assetsRoot, `${id}.mp4`), thumb = path.join(assetsRoot, `${id}.jpg`);
    outputs.push(raw, out, thumb);
    await runTool('ffmpeg', ['-y', '-v', 'error', '-i', input, '-an', '-vf', "scale=w='min(3840,iw)':h=-2,fps=30,setsar=1", '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', raw]);
    const rawInfo = await probe(raw), d = Number(rawInfo.format.duration);
    // Rotate the loop phase: [L,D] then dissolve the tail over [0,L].
    // The exported last frame lands just before L; next loop begins exactly at L.
    const overlap = Math.floor(Math.min(.8, d / 4) * 30) / 30;
    if (overlap >= 2 / 30) {
      const filter = `[0:v]split[a][b];[a]trim=start=${overlap}:end=${d},setpts=PTS-STARTPTS[a1];[b]trim=start=0:end=${overlap},setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=${overlap}:offset=${Math.max(0, d - 2 * overlap)}[v]`;
      await runTool('ffmpeg', ['-y', '-v', 'error', '-threads', '2', '-i', raw, '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    } else await fs.copyFile(raw, out);
    await runTool('ffmpeg', ['-y', '-v', 'error', '-i', out, '-frames:v', '1', '-vf', 'scale=960:-2', thumb]);
    const meta = await probe(out), s = meta.streams.find(s => s.codec_type === 'video')!;
    await fs.rm(raw, {force: true});
    return {asset: {src: `assets/${id}.mp4`, name, kind: 'video', duration: Number(meta.format.duration), width: s.width, height: s.height, thumbnail: `assets/${id}.jpg`, loopPrepared: overlap >= 2 / 30}};
  } catch (e) {await Promise.all(outputs.map(p => fs.rm(p, {force: true}).catch(() => {}))); throw e;}
}
export function createTrack(asset: Asset, title: string, artist: string): Track {
  if (asset.kind !== 'audio' || !asset.duration) throw new Error('歌曲导入失败。');
  return {id: randomUUID(), title, artist, audio: {...asset, kind: 'audio', duration: asset.duration}, focus: {x: .5, y: .5}};
}
