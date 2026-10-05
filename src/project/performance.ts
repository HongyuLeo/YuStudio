import type {Project, Orientation} from './model';
export type MachineInfo = {maxConcurrency: number; memoryGiB: number; cpu: string};
export function performanceSettings(p: Project) {
  return {encoder: p.render.encoder ?? 'auto', speed: p.render.speed ?? 'balanced', cacheMiB: p.render.cacheMiB ?? 1024,
    videoThreads: p.render.videoThreads ?? 4, videoReader:p.render.readerVersion===2 && p.render.videoReader==='auto'?'auto' as const:'cached' as const, gl: p.render.gl ?? 'angle'};
}
export function videoBitrate(p: Project, orientation: Orientation) {
  const resolution = orientation === 'portrait' ? '1080p' : p.render.resolution;
  const base = resolution === '4k' ? 60 : resolution === '1440p' ? 30 : 16;
  return `${p.render.bitrateMbps ?? base * (p.fps === 60 ? 1.5 : 1) * (p.render.codec === 'h265' ? .7 : 1)}M`;
}
export const nvencPreset = {fast: 'p1', balanced: 'p4', quality: 'p7'} as const;
export const cpuPreset = {fast: 'veryfast', balanced: 'medium', quality: 'slow'} as const;
export function encodingOptions(p: Project, orientation: Orientation, hardware: boolean) {
  return hardware
    ? {hardwareAcceleration: 'required' as const, videoBitrate: videoBitrate(p, orientation), x264Preset: null}
    : {hardwareAcceleration: 'disable' as const, ...(p.render.bitrateMbps ? {videoBitrate: videoBitrate(p, orientation)} : {crf: 18}), x264Preset: p.render.codec === 'h264' ? cpuPreset[performanceSettings(p).speed] : null};
}
export function encoderArguments(args: string[], hardware: boolean, speed: ReturnType<typeof performanceSettings>['speed']) {
  const actual = args.find(arg => ['h264_nvenc', 'hevc_nvenc', 'libx264', 'libx265'].includes(arg));
  if (hardware && actual && !actual.endsWith('_nvenc')) throw new Error('强制 NVENC 模式未选中 NVIDIA 编码器，生成已停止。');
  if (actual?.endsWith('_nvenc')) return [...args.slice(0, -1), '-preset', nvencPreset[speed], ...args.slice(-1)];
  if (actual === 'libx265') return [...args.slice(0, -1), '-preset', cpuPreset[speed], ...args.slice(-1)];
  return args;
}
export function fullPowerSettings(machine: MachineInfo): Partial<Project['render']> {
  return {concurrency: machine.maxConcurrency, autoConcurrency:true, encoder: 'nvenc', speed: 'fast', cacheMiB: 4096,
    videoThreads: 2, videoReader:'cached',readerVersion:2,gl: 'angle'};
}
