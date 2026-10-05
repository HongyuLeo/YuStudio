import {z} from 'zod';

export const assetSchema = z.object({
  src: z.string().min(1), name: z.string().min(1),
  kind: z.enum(['audio', 'image', 'video']), duration: z.number().positive().optional(),
  width: z.number().positive().optional(), height: z.number().positive().optional(),
  thumbnail: z.string().optional(), loopPrepared: z.boolean().optional(),
});
export const trackSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(160), artist: z.string().max(160),
  audio: assetSchema.extend({kind: z.literal('audio'), duration: z.number().positive().max(86400)}),
  background: assetSchema.optional(),
  atmosphere: z.object({preset: z.enum(['embers', 'snow', 'fireflies', 'none']), amount: z.number().min(0).max(1)}).optional(),
  focus: z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1)}),
});
export const projectSchema = z.object({
  version: z.literal(1), id: z.string().min(1), name: z.string().min(1).max(160),
  subtitle: z.string().max(160), template: z.literal('cinematic-glass'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fps: z.union([z.literal(30), z.literal(60)]),
  tracks: z.array(trackSchema).max(200),
  presentation: z.object({showPlaylist: z.boolean(), showProgress: z.boolean()}).optional(),
  render: z.object({landscape: z.boolean(), portrait: z.boolean(),
    resolution: z.enum(['1080p', '1440p', '4k']), codec: z.enum(['h264', 'h265']),
    concurrency: z.number().int().positive().safe(),
    autoConcurrency: z.boolean().optional(),
    encoder: z.enum(['auto', 'nvenc', 'cpu']).optional(),
    speed: z.enum(['fast', 'balanced', 'quality']).optional(),
    cacheMiB: z.number().int().positive().safe().optional(),
    videoThreads: z.number().int().positive().safe().optional(),
    videoReader: z.enum(['auto', 'legacy','cached']).optional(),
    readerVersion:z.literal(2).optional(),
    bitrateMbps: z.number().positive().max(1000).optional(),
    gl: z.enum(['angle', 'swiftshader']).optional()}),
}).superRefine((p, ctx) => {
  if (new Set(p.tracks.map(t => t.id)).size !== p.tracks.length)
    ctx.addIssue({code: 'custom', path: ['tracks'], message: '歌曲 ID 重复'});
  for (const [i, t] of p.tracks.entries())
    if (t.background?.kind === 'audio') ctx.addIssue({code: 'custom', path: ['tracks', i, 'background'], message: '背景必须是图片或视频'});
});
export type Asset = z.infer<typeof assetSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Orientation = 'landscape' | 'portrait';
export const newProject = (): Project => ({
  version: 1, id: crypto.randomUUID(), name: '我的音乐影像', subtitle: 'A COLLECTION OF MOMENTS',
  template: 'cinematic-glass', accent: '#d6d3b5', fps: 30, tracks: [],
  render: {landscape: true, portrait: true, resolution: '4k', codec: 'h264', concurrency: 4, encoder: 'auto', speed: 'balanced', cacheMiB: 1024, videoThreads: 2,videoReader:'cached',readerVersion:2, gl: 'angle'},
});
export function dimensions(p: Project, orientation: Orientation) {
  if (orientation === 'portrait') return {width: 1080, height: 1920};
  return p.render.resolution === '4k' ? {width: 3840, height: 2160}
    : p.render.resolution === '1440p' ? {width: 2560, height: 1440} : {width: 1920, height: 1080};
}
export function validateForRender(p: Project) {
  projectSchema.parse(p);
  if (!p.tracks.length) throw new Error('请先导入至少一首歌曲。');
  if (!p.render.landscape && !p.render.portrait) throw new Error('请选择至少一种输出比例。');
  const missing = p.tracks.filter(t => !t.background).map(t => t.title);
  if (missing.length) throw new Error(`这些歌曲还没有背景：${missing.join('、')}`);
}
