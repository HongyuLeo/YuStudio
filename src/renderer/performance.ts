import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {nvencProbeFrame} from './nvenc-probe-frame';
import {RenderInternals} from '@remotion/renderer';
import type {Project} from '../project/model';
import type {MachineInfo} from '../project/performance';
import {nvencPreset, performanceSettings} from '../project/performance';

// Keep runtime introspection in one adapter; Remotion is pinned to 4.0.532.
export function machineInfo(): MachineInfo {
  return {maxConcurrency: RenderInternals.getMaxConcurrency(), memoryGiB: Math.round(os.totalmem() / 1024 ** 3), cpu: os.cpus()[0]?.model ?? 'CPU'};
}
export function validatePerformance(project: Project) {
  const max = machineInfo().maxConcurrency;
  if (project.render.concurrency > max) throw new Error(`本机渲染器支持最多 ${max} 并发，当前填写 ${project.render.concurrency}。请填写 1–${max}；软件不再限制为 12 或 16。`);
}
export type EncoderChoice = {hardware: boolean; name: string; fallback?: string};
export async function chooseEncoder(project: Project, signal?: AbortSignal): Promise<EncoderChoice> {
  const settings = performanceSettings(project);
  const cpu = project.render.codec === 'h264' ? 'libx264' : 'libx265';
  if (settings.encoder === 'cpu') return {hardware: false, name: cpu};
  const encoder = project.render.codec === 'h264' ? 'h264_nvenc' : 'hevc_nvenc';
  try {
    const executable = RenderInternals.getExecutablePath({type: 'ffmpeg', binariesDirectory: process.env.REMOTION_BINARIES_DIRECTORY ?? null, indent: false, logLevel: 'warn'});
    // Encode a real PNG frame: -encoders alone cannot detect a missing GPU/driver.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['-hide_banner', '-v', 'error', '-f', 'image2pipe', '-vcodec', 'png', '-r', '30', '-i', 'pipe:0', '-frames:v', '1', '-pix_fmt', 'yuv420p', '-c:v', encoder, '-preset', nvencPreset[settings.speed], '-b:v', '8M', '-f', 'null', '-'], {cwd: path.dirname(executable), windowsHide: true, signal, stdio: ['pipe', 'ignore', 'pipe']});
      let detail = '';
      const timeout = setTimeout(() => {child.kill(); reject(new Error('NVENC 初始化超过 15 秒'));}, 15000);
      child.stderr.on('data', data => {detail = (detail + String(data)).slice(-6000);});
      child.stdin.on('error', () => {});
      child.on('error', err => {clearTimeout(timeout); reject(err);});
      child.on('close', code => {clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(detail.trim() || `FFmpeg 退出码 ${code}`));});
      child.stdin.end(nvencProbeFrame);
    });
    return {hardware: true, name: encoder};
  } catch (e) {
    if (signal?.aborted) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    if (settings.encoder === 'nvenc') throw new Error(`强制 NVIDIA NVENC 初始化失败，本次生成已停止。\n${reason}`);
    return {hardware: false, name: cpu, fallback: `NVENC 不可用，自动模式改用 CPU：${reason}`};
  }
}
