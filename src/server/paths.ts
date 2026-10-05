import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
export const root = process.env.NOCTURNE_ROOT || process.cwd();
export const dataRoot = path.resolve(process.env.NOCTURNE_DATA || path.join(root, '.nocturne'));
export const assetsRoot = path.join(dataRoot, 'assets');
export const outputRoot = path.join(dataRoot, 'exports');
export const projectsRoot = path.join(dataRoot, 'projects');
for (const folder of [assetsRoot, outputRoot, projectsRoot]) fs.mkdirSync(folder, {recursive: true});
export function mediaTool(tool: 'ffmpeg' | 'ffprobe') {
  const env = process.env[tool === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  if (env) return env;
  try {
    const binary = tool === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path;
    const unpacked = typeof binary === 'string' ? binary.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep) : '';
    if (unpacked && fs.existsSync(unpacked)) return unpacked;
    if (binary && fs.existsSync(binary)) return binary;
  } catch {}
  return tool;
}
export function safeAssetPath(src: string) {
  const match = /^(?:assets\/|demo\/)([^/\\]+)$/.exec(src);
  if (!match || match[1] === '..' || match[1] === '.') throw new Error('素材路径无效，请重新导入。');
  return src.startsWith('demo/') ? path.join(process.env.NOCTURNE_DEMO || path.join(root, 'public/demo'), match[1]) : path.join(assetsRoot, match[1]);
}
export const publicSrc = (src: string, origin: string) => `${origin}/${src.startsWith('demo/') ? src : `media/${src.slice(7)}`}`;
