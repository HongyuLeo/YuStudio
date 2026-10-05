import {useI18n} from '../i18n';
import React, {useEffect, useState} from 'react';
import type {Project} from '../project/model';
import {api} from '../project/api';
import {fullPowerSettings, performanceSettings, type MachineInfo} from '../project/performance';

function NumberField({label, value, min = 1, max, step = 1, disabled, onChange}: {label: string; value: number; min?: number; max?: number; step?: number; disabled: boolean; onChange: (value: number) => void}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} disabled={disabled} value={draft}
    onChange={e => {setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value && Number.isFinite(n) && n >= min && (step !== 1 || Number.isInteger(n))) onChange(n);}}
    onBlur={() => setDraft(String(value))}/></label>;
}
export function PerformanceControls({project, disabled, update}: {project: Project; disabled: boolean; update: (settings: Partial<Project['render']>) => void}) {
  const {t:tr} = useI18n();
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [cache,setCache]=useState<{bytes:number;backgrounds:number}|null>(null),[cacheMessage,setCacheMessage]=useState('');
  useEffect(() => {api<MachineInfo>('/api/performance').then(setMachine).catch(() => {});}, []);
  useEffect(()=>{api<{bytes:number;backgrounds:number}>('/api/frame-cache').then(setCache).catch(()=>{});},[disabled]);
  const settings = performanceSettings(project);
  return <div className="performance-controls">
    <div className="label-row"><h3>{tr("生成性能")}</h3><button className="power-button" disabled={disabled || !machine} onClick={() => machine && update(fullPowerSettings(machine))}>{tr("全力输出")}</button></div>
    <p className="micro-hint">{machine ? tr(`${machine.maxConcurrency} 个逻辑线程 · ${machine.memoryGiB} GB 内存`) : tr("正在读取本机配置…")}<br/>{tr("全力输出：强制 NVENC + 无损背景缓存 + 实测最快并发。测速包含本机最大并发，速度以实际输出为准。")}</p>
    <label className="field-label">{tr("编码设备")}<select aria-label={tr("编码设备")} disabled={disabled} value={settings.encoder} onChange={e => update({encoder: e.target.value as typeof settings.encoder})}>
      <option value="nvenc">{tr("NVIDIA NVENC · 强制 GPU")}</option><option value="auto">{tr("GPU 优先 · 不可用时 CPU")}</option><option value="cpu">{tr("CPU 编码")}</option>
    </select></label>
    <div className="export-fields">
      <NumberField label={tr("渲染并发")} value={project.render.concurrency} max={machine?.maxConcurrency} disabled={disabled} onChange={concurrency => update({concurrency,autoConcurrency:false})}/>
      <label>{tr("编码档位")}<select aria-label={tr("编码档位")} disabled={disabled} value={settings.speed} onChange={e => update({speed: e.target.value as typeof settings.speed})}><option value="fast">{tr("极速")}</option><option value="balanced">{tr("均衡")}</option><option value="quality">{tr("精细压缩")}</option></select></label>
    </div>
    <div className="concurrency-shortcuts">{[4,8, 12, 16, 24, 32, 48, 64].filter(n => !machine || n <= machine.maxConcurrency).map(n => <button key={n} disabled={disabled} className={n === project.render.concurrency ? 'active' : ''} onClick={() => update({concurrency: n,autoConcurrency:false})}>{n}</button>)}</div>
    <label className="toggle"><input aria-label={tr("实测最快并发")} type="checkbox" disabled={disabled} checked={!!project.render.autoConcurrency} onChange={e=>update({autoConcurrency:e.target.checked})}/>{tr("实测最快并发")}</label>
    <p className="micro-hint">{tr("生成前用当前画质测试 4 / 8 / 16 / 32、本机最大值及填写值，按完成画面和编码的实际吞吐选择。测速需要额外时间，横竖屏分别测；修改并发数字会切回手动。帧率、分辨率、码率与特效保持原设置。")}</p>
    <div className="export-fields">
      <NumberField label={tr("视频缓存 / MB")} value={settings.cacheMiB} disabled={disabled} onChange={cacheMiB => update({cacheMiB})}/>
      <NumberField label={tr("视频解码线程")} value={settings.videoThreads} disabled={disabled} onChange={videoThreads => update({videoThreads})}/>
    </div>
    <label className="field-label">{tr("视频背景读取")}<select aria-label={tr("视频背景读取")} disabled={disabled} value={settings.videoReader} onChange={e => update({videoReader:e.target.value as typeof settings.videoReader,readerVersion:2})}>
      <option value="cached">{tr("无损帧缓存 · 循环背景优先")}</option><option value="auto">{tr("快速读取 · 浏览器解码")}</option>
    </select></label>
    <p className="micro-hint">{tr("无损帧缓存首次准备占用磁盘，后续重复使用；解码线程只用于准备视频。上方 MB 用于快速视频读取，磁盘帧缓存单独计量。快速读取无法解码会在生成前报告。分辨率、帧率和场景特效保持原设置。")}</p>
    <div className="label-row"><span className="micro-hint">{tr("背景磁盘缓存：")}{cache?tr(`${(cache.bytes/1024**3).toFixed(2)} GB · ${cache.backgrounds} 个背景`):tr("读取中…")}</span><button disabled={disabled || !cache?.backgrounds} onClick={async()=>{try{setCache(await api('/api/frame-cache/clear',{method:'POST'}));setCacheMessage('已清理，下次生成会重新准备。');}catch(e){setCacheMessage(String(e));}}}>{tr("清理背景缓存")}</button></div>
    {cacheMessage && <p className="micro-hint">{tr(cacheMessage)}</p>}
    <div className="export-fields"><label>{tr("画面渲染")}<select aria-label={tr("画面渲染")} disabled={disabled} value={settings.gl} onChange={e => update({gl: e.target.value as typeof settings.gl})}><option value="angle">{tr("GPU 优先 / ANGLE")}</option><option value="swiftshader">{tr("软件 / SwiftShader")}</option></select></label>
      <NumberField label={tr("码率 / Mbps（0 自动）")} value={project.render.bitrateMbps ?? 0} min={0} max={1000} step={.5} disabled={disabled} onChange={bitrateMbps => update({bitrateMbps: bitrateMbps || undefined})}/>
    </div>
    <p className="micro-hint">{tr("并发可自行填写 1–")}{machine?.maxConcurrency ?? tr("本机线程数")}{tr("。强制 NVENC 失败会直接报告；生成面板显示实际绘图设备、编码器及近期速度，可直接下载诊断报告。")}</p>
  </div>;
}
