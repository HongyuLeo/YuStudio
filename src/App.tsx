import {useI18n} from './i18n';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {CinematicGlass} from './compositions/CinematicGlass';
import {type Project, type Track, type Orientation, newProject, projectSchema} from './project/model';
import {api, upload, assetUrl, previewProject} from './project/api';
import {timestamp, timeline, totalFrames} from './timeline';
import {Icon} from './components/Icon';
import {PerformanceControls} from './components/PerformanceControls';
import type {RenderJob} from './renderer/pipeline';
import './styles.css';
const storageKey = 'nocturne.project.v1';
export function App() {
  const {language, setLanguage, t:tr} = useI18n();
  const [project, setProject] = useState<Project>(newProject);
  const [selected, setSelected] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(''), [toast, setToast] = useState(''), [error, setError] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const player = useRef<PlayerRef>(null);
  const audioInput = useRef<HTMLInputElement>(null), bgInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const cues = useMemo(() => timeline(project), [project]);
  const track = project.tracks.find(t => t.id === selected) ?? project.tracks[0];
  const props = useMemo(() => ({project: previewProject(project), orientation}), [project, orientation]);
  const frames = totalFrames(project);
  const rendering = !!job && ['preparing', 'rendering'].includes(job.state);
  const locked = !!busy || rendering;
  const notify = (text: string, isError = false) => {setToast(text); setError(isError);};
  function install(p: Project) {player.current?.pause(); setPlaying(false); setProject(p); setSelected(p.tracks[0]?.id ?? ''); player.current?.seekTo(0); setFrame(0);}
  useEffect(() => {
    void (async () => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {const parsed = projectSchema.parse(JSON.parse(saved)); const {project: p} = await api<{project: Project}>('/api/project/open', parsed); install(p);}
          catch {install(await api<Project>('/api/demo')); notify('上次项目的素材暂时不可用，已打开演示。可重新打开项目并绑定素材。', true);}
        } else install(await api<Project>('/api/demo'));
      } catch {notify('本地服务没有连接，请用启动脚本打开应用。', true);}
      finally {loaded.current = true;}
    })();
  }, []);
  useEffect(() => {if (loaded.current) localStorage.setItem(storageKey, JSON.stringify(project));}, [project]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), error ? 18000 : 6000); return () => clearTimeout(t);
  }, [toast, error]);
  useEffect(() => {
    const p = player.current; if (!p) return;
    const update = (e: {detail: {frame: number}}) => setFrame(e.detail.frame);
    const play = () => setPlaying(true), pause = () => setPlaying(false);
    p.addEventListener('frameupdate', update); p.addEventListener('play', play); p.addEventListener('pause', pause); p.addEventListener('ended', pause);
    return () => {p.removeEventListener('frameupdate', update); p.removeEventListener('play', play); p.removeEventListener('pause', pause); p.removeEventListener('ended', pause);};
  }, [project.tracks.length > 0]);
  useEffect(() => {
    if (!job || !['preparing', 'rendering'].includes(job.state)) return;
    let live = true;
    const poll = setInterval(() => {api<RenderJob>(`/api/render/${job.id}`).then(next => {if (live) setJob(next);}).catch(e => {if (live) notify(e.message, true);});}, 900);
    return () => {live = false; clearInterval(poll);};
  }, [job?.id, job?.state]);
  function updateTrack(id: string, update: Partial<Track>) {setProject(p => ({...p, tracks: p.tracks.map(t => t.id === id ? {...t, ...update} : t)}));}
  function choose(id: string) {setSelected(id); const cue = cues.find(c => c.track.id === id); if (cue) {player.current?.seekTo(cue.start); setFrame(cue.start);}}
  function move(id: string, to: number) {
    setProject(p => {const tracks = [...p.tracks], from = tracks.findIndex(t => t.id === id); if (from < 0 || to < 0 || to >= tracks.length) return p;
      tracks.splice(to, 0, tracks.splice(from, 1)[0]); return {...p, tracks};});
  }
  async function importAudio(files: File[]) {
    if (!files.length) return;
    player.current?.pause();
    try {
      const imported: Track[] = [], errors: string[] = [];
      for (const [i, file] of files.entries()) {
        setBusy(`导入歌曲 ${i + 1}/${files.length} · ${file.name}`);
        const results = await upload([file], 'audio');
        for (const r of results) {if (r.track) imported.push(r.track); if (r.error) errors.push(`${r.name}: ${tr(r.error!)}`);}
      }
      if (imported.length) {setProject(p => ({...p, tracks: [...p.tracks, ...imported]})); setSelected(imported[0].id);}
      notify(errors.length ? errors.join('\n') : `已导入 ${imported.length} 首歌曲，请给每首歌绑定背景。`, !!errors.length);
    } catch (e) {notify((e as Error).message, true);} finally {setBusy('');}
  }
  async function importBackground(file?: File) {
    if (!file || !track) return;
    const id = track.id;
    player.current?.pause(); setBusy(`准备背景 · ${file.name}（视频会自动处理循环接缝）`);
    try {
      const [r] = await upload([file], 'background'); if (r.error) throw new Error(tr(r.error));
      updateTrack(id, {background: r.asset, focus: {x: .5, y: .5}}); notify('背景已绑定，点击下方图片可设置主体焦点。');
    } catch (e) {notify((e as Error).message, true);} finally {setBusy('');}
  }
  async function save() {
    try {const result = await api<{url: string}>('/api/project/save', project);
      if (window.studio) {const saved = await window.studio.saveProject(project); if (saved.cancelled) return;}
      else {const a = document.createElement('a'); a.href = result.url; a.download = 'project.json'; a.click();}
      notify('项目已保存。导入素材由应用保留在本机。');
    } catch (e) {notify((e as Error).message, true);}
  }
  async function open(value: unknown) {try {const {project: p} = await api<{project: Project}>('/api/project/open', value); install(p); notify('项目已打开。');} catch (e) {notify((e as Error).message, true);}}
  async function render() {
    player.current?.pause();
    try {setJob(await api<RenderJob>('/api/render', project));} catch (e) {notify((e as Error).message, true);}
  }
  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand"><svg className="brand-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><circle cx="128" cy="128" r="121" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="6"/><path d="M62 62h38l28 58 28-58h38l-48 94v38h-36v-38z" fill="currentColor"/></svg><div><b>YuStudio</b><small>{tr("音乐影像工作室")}</small></div></div>
      <div className="top-status"><span className="status-dot"/>{tr("本地创作")} <span className="divider">/</span> CINEMATIC GLASS</div>
      <div className="top-actions">
        <select className="language-switch" aria-label="Language / 语言" value={language} onChange={e => setLanguage(e.target.value as typeof language)}><option value="zh-CN">中文</option><option value="en">English</option></select>
        <button className="quiet" disabled={locked} onClick={() => {install({...newProject(), name:tr("我的音乐影像")}); notify('新项目已创建。');}}><Icon name="plus"/>{tr("新建")}</button>
        <button className="quiet" disabled={locked} onClick={() => window.studio ? window.studio.openProject().then(p => {if (p) void open(p);}).catch(e => notify(e.message, true)) : projectInput.current?.click()}><Icon name="folder"/>{tr("打开")}</button>
        <button className="quiet" disabled={locked} onClick={save}><Icon name="save"/>{tr("保存项目")}</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="playlist-editor">
        <div className="section-label">01 <span>PLAYLIST</span><small>{String(project.tracks.length).padStart(2, '0')} {tr("首")}</small></div>
        <h2>{tr("每一首，都有自己的画面。")}</h2>
        <p className="section-hint">{tr("导入音乐，为它选择一个场景。")}</p>
        <button className="import-button" disabled={locked} onClick={() => audioInput.current?.click()}><Icon name="plus"/>{tr("导入歌曲")}</button>
        <div className="track-list">
          {!project.tracks.length && <div className="empty-list"><Icon name="music" size={35}/><p>{tr("从第一首音乐开始")}</p><small>MP3 · WAV · FLAC · AAC · M4A</small></div>}
          {project.tracks.map((t, i) => <div key={t.id} className={`track-card ${track?.id === t.id ? 'selected' : ''} ${drag === t.id ? 'dragging' : ''}`} draggable={!locked}
            onDragStart={e => {setDrag(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move';}}
            onDragEnd={() => setDrag(null)} onDragOver={e => {e.preventDefault(); e.dataTransfer.dropEffect = 'move';}}
            onDrop={e => {e.preventDefault(); move(e.dataTransfer.getData('text/plain'), i); setDrag(null);}}>
            <button className="track-select" disabled={locked} onClick={() => choose(t.id)}>
              <span className="track-thumb">{t.background ? <img src={assetUrl(t.background.thumbnail ?? t.background.src)} alt="" onError={e => {(e.target as HTMLImageElement).style.display = 'none';}}/> : <Icon name="image"/>}<span>{String(i + 1).padStart(2, '0')}</span></span>
              <span className="track-text"><b>{t.title}</b><small>{t.artist || tr("歌手未填写")}</small><em>{timestamp(t.audio.duration)} <span>·</span> {t.background ? t.background.kind === 'video' ? tr("循环视频") : tr("动态镜头") : tr("待绑定背景")}</em></span>
            </button>
            <div className="row-actions"><button title={tr("上移")} aria-label={tr("上移")} disabled={locked || i === 0} onClick={() => move(t.id, i - 1)}>↑</button><button title={tr("下移")} aria-label={tr("下移")} disabled={locked || i === project.tracks.length - 1} onClick={() => move(t.id, i + 1)}>↓</button><button title={tr("移除歌曲")} aria-label={tr("移除歌曲")} disabled={locked} onClick={() => setProject(p => ({...p, tracks: p.tracks.filter(x => x.id !== t.id)}))}><Icon name="close" size={12}/></button></div>
          </div>)}
        </div>
        <div className="sidebar-bottom"><span>{timestamp(frames / project.fps)} {tr("总时长")}</span><span>{tr("拖拽调整顺序")}</span></div>
        <button className="demo-link" disabled={locked} onClick={() => api<Project>('/api/demo').then(install).catch(e => notify(e.message, true))}>{tr("打开原创演示歌单")} <Icon name="arrow" size={14}/></button>
      </aside>
      <section className="canvas-workspace">
        <div className="preview-heading"><div><div className="section-label">02 <span>LIVE PREVIEW</span></div><h1>{tr("让音乐，有画面。")}</h1></div><div className="aspect-switch"><button className={orientation === 'landscape' ? 'active' : ''} onClick={() => setOrientation('landscape')}><Icon name="wide" size={16}/>16:9</button><button className={orientation === 'portrait' ? 'active' : ''} onClick={() => setOrientation('portrait')}><Icon name="tall" size={16}/>9:16</button></div></div>
        <div className={`preview-stage ${orientation}`}>
          <div className="stage-corner tl"/><div className="stage-corner tr"/><div className="stage-corner bl"/><div className="stage-corner br"/>
          {project.tracks.length ? <Player ref={player} component={CinematicGlass} durationInFrames={frames} fps={project.fps} compositionWidth={orientation === 'landscape' ? 1920 : 1080} compositionHeight={orientation === 'landscape' ? 1080 : 1920}
            inputProps={props} controls={false} clickToPlay={false} loop style={{width: '100%', maxWidth: orientation === 'portrait' ? 286 : undefined, aspectRatio: orientation === 'portrait' ? '9 / 16' : '16 / 9'}}
            errorFallback={({error}) => <div className="preview-error">{tr("预览素材无法解码，请重新绑定背景。")}<small>{error.message}</small></div>}/>
            : <div className="empty-preview"><Icon name="music" size={42}/><h3>{tr("给音乐一个场景")}</h3><p>{tr("导入歌曲后，这里会实时呈现你的作品。")}</p></div>}
        </div>
        <div className="transport"><button className="play-button" disabled={!project.tracks.length || !!busy} onClick={() => {player.current?.toggle();}} aria-label={playing ? tr("暂停") : tr("播放")}><Icon name={playing ? 'pause' : 'play'} size={19}/></button><span>{timestamp(frame / project.fps)}</span><input aria-label={tr("预览时间")} type="range" min={0} max={Math.max(1, frames - 1)} value={Math.min(frame, frames - 1)} onChange={e => {const f = Number(e.target.value); player.current?.seekTo(f); setFrame(f);}}/><span>{timestamp(frames / project.fps)}</span><span className="preview-quality">{project.fps} FPS <i/>{tr("实时预览")}</span></div>
        <div className="project-details"><label>{tr("项目名称（仅保存用）")}<input disabled={locked} value={project.name} onChange={e => setProject(p => ({...p, name: e.target.value}))}/></label><label>{tr("项目备注（不显示在视频）")}<input disabled={locked} value={project.subtitle} onChange={e => setProject(p => ({...p, subtitle: e.target.value}))}/></label></div>
        <div className="timeline-label"><span>SCENES</span><small>{tr("同一时间轴 · 两种独立构图")}</small></div>
        <div className="scene-strip">{project.tracks.map((t, i) => <button key={t.id} className={selected === t.id ? 'active' : ''} onClick={() => choose(t.id)}><span className="scene-art" style={{backgroundImage: `url("${assetUrl(t.background?.thumbnail ?? (t.background?.kind === 'image' ? t.background.src : undefined)) ?? ''}")`}}/><span className="scene-number">{String(i + 1).padStart(2, '0')}</span><span className="scene-name">{t.title}</span></button>)}</div>
        <div className="canvas-note"><span className="status-dot"/>{tr("更换焦点后，横竖屏都会重新构图。原图亮度保留，分层氛围可逐首调整。")}</div>
      </section>
      <aside className="inspector">
        <div className="section-label">03 <span>SCENE & EXPORT</span></div>
        <div className="inspector-section"><div className="label-row"><h3>{tr("当前场景")}</h3><span>{track ? String(project.tracks.indexOf(track) + 1).padStart(2, '0') : '—'}</span></div>
          <label className="field-label">{tr("歌曲名称")}<input disabled={locked || !track} value={track?.title ?? ''} onChange={e => track && updateTrack(track.id, {title: e.target.value})}/></label>
          <label className="field-label">{tr("歌手")}<input disabled={locked || !track} value={track?.artist ?? ''} onChange={e => track && updateTrack(track.id, {artist: e.target.value})}/></label>
          <div className="label-row background-label"><h3>{tr("背景与焦点")}</h3><button className="text-button" disabled={locked || !track} onClick={() => bgInput.current?.click()}>{tr("更换背景")}</button></div>
          <button className={`focus-preview ${track?.background ? '' : 'unbound'}`} disabled={locked || !track} title={tr("点击画面设置主体焦点")} onClick={e => {
            if (!track) return;
            if (!track.background) {bgInput.current?.click(); return;}
            const r = e.currentTarget.getBoundingClientRect(); updateTrack(track.id, {focus: {x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))}});
          }} style={{aspectRatio: track?.background?.width && track.background.height ? `${track.background.width}/${track.background.height}` : '16/9'}}>
            {track?.background ? <><img src={assetUrl(track.background.thumbnail ?? track.background.src)} alt={tr("背景焦点定位")}/><span className="focus-marker" style={{left: `${track.focus.x * 100}%`, top: `${track.focus.y * 100}%`}}/></> : <><Icon name="image" size={26}/><small>{tr("选择图片 / 短视频")}</small></>}
          </button>
          <div className="focus-fields">{(['x', 'y'] as const).map(axis => <label key={axis}>FOCUS {axis.toUpperCase()}<input aria-label={`Focus ${axis.toUpperCase()}`} disabled={locked || !track} type="number" min={0} max={100} step={1} value={Math.round((track?.focus[axis] ?? .5) * 100)} onChange={e => track && updateTrack(track.id, {focus: {...track.focus, [axis]: Math.max(0, Math.min(1, Number(e.target.value) / 100))}})}/><span>%</span></label>)}</div>
          <p className="micro-hint">{tr("点击图片中的主体。裁切尽量保留它。")}</p>
          <div className="atmosphere-controls"><label className="field-label">{tr("场景氛围")}<select aria-label={tr("场景氛围")} disabled={locked || !track} value={track?.atmosphere?.preset ?? 'embers'} onChange={e => track && updateTrack(track.id, {atmosphere: {preset: e.target.value as NonNullable<Track['atmosphere']>['preset'], amount: track.atmosphere?.amount ?? .65}})}><option value="embers">{tr("暖色火星")}</option><option value="snow">{tr("轻柔飘雪")}</option><option value="fireflies">{tr("萤光漂浮")}</option><option value="none">{tr("关闭氛围")}</option></select></label>
          <label className="field-label atmosphere-strength">{tr("氛围强度")} <span>{Math.round((track?.atmosphere?.amount ?? .65) * 100)}%</span><input aria-label={tr("氛围强度")} disabled={locked || !track || track.atmosphere?.preset === 'none'} type="range" min="0" max="100" value={Math.round((track?.atmosphere?.amount ?? .65) * 100)} onChange={e => track && updateTrack(track.id, {atmosphere: {preset: track.atmosphere?.preset ?? 'embers', amount: Number(e.target.value) / 100}})}/></label><p className="micro-hint">{tr("远景光点、中景粒子、虚化前景与缓慢雾光。视频已有特效时可关闭。")}</p></div>
        </div>
        <div className="inspector-section template-section"><div className="label-row"><h3>{tr("视觉模板")}</h3><span className="tiny-badge">01</span></div><div className="template-card"><span className="template-orb"/><div><b>Cinematic Glass</b><small>{tr("分层粒子 · 轻盈文字 · 原图亮度")}</small></div><Icon name="check" size={15}/></div><label className="color-field">{tr("点缀颜色")}<input disabled={locked} type="color" value={project.accent} onChange={e => setProject(p => ({...p, accent: e.target.value}))}/><small>{project.accent.toUpperCase()}</small></label><label className="check-row"><input aria-label={tr("显示歌单")} disabled={locked} type="checkbox" checked={project.presentation?.showPlaylist ?? true} onChange={e => setProject(p => ({...p, presentation: {showProgress: p.presentation?.showProgress ?? true, showPlaylist: e.target.checked}}))}/>{tr("显示歌单")}</label><label className="check-row"><input aria-label={tr("显示进度条")} disabled={locked} type="checkbox" checked={project.presentation?.showProgress ?? true} onChange={e => setProject(p => ({...p, presentation: {showPlaylist: p.presentation?.showPlaylist ?? true, showProgress: e.target.checked}}))}/>{tr("显示进度条")}</label></div>
        <div className="inspector-section export-section"><div className="label-row"><h3>{tr("导出作品")}</h3><span className="export-local">{tr("本地渲染")}</span></div>
          <label className="check-row"><input disabled={locked} type="checkbox" checked={project.render.landscape} onChange={e => setProject(p => ({...p, render: {...p.render, landscape: e.target.checked}}))}/><Icon name="wide" size={18}/><b>{tr("横屏 16:9")}</b><span>YouTube</span></label>
          <label className="check-row"><input disabled={locked} type="checkbox" checked={project.render.portrait} onChange={e => setProject(p => ({...p, render: {...p.render, portrait: e.target.checked}}))}/><Icon name="tall" size={18}/><b>{tr("竖屏 9:16")}</b><span>Shorts</span></label>
          <div className="export-fields"><label>{tr("横屏清晰度")}<select disabled={locked} value={project.render.resolution} onChange={e => setProject(p => ({...p, render: {...p.render, resolution: e.target.value as Project['render']['resolution']}}))}><option value="1080p">1080p</option><option value="1440p">1440p</option><option value="4k">4K UHD</option></select></label><label>{tr("帧率")}<select disabled={locked} value={project.fps} onChange={e => setProject(p => ({...p, fps: Number(e.target.value) as 30 | 60}))}><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label></div>
          <label className="field-label">{tr("视频编码")}<select aria-label={tr("视频编码")} disabled={locked} value={project.render.codec} onChange={e => setProject(p => ({...p, render: {...p.render, codec: e.target.value as 'h264' | 'h265'}}))}><option value="h264">H.264</option><option value="h265">H.265</option></select></label>
          <PerformanceControls project={project} disabled={locked} update={settings => setProject(p => ({...p, render: {...p.render, ...settings}}))}/>
          <p className="micro-hint">{tr("竖屏固定 1080 × 1920 · AAC 48 kHz")}<br/>{tr("自动生成 YouTube 章节时间戳。")}</p>
          <button className="render-button" disabled={locked || !project.tracks.length} onClick={render}><Icon name="export"/>{rendering ? tr("正在生成作品…") : tr("生成音乐影像")}<Icon name="arrow" size={16}/></button>
        </div>
      </aside>
    </main>
    <footer className="app-footer"><span>YuStudio <i/> v1.3.1</span><span>{tr(busy) || (rendering ? tr(job.message) : tr("项目会在本机自动记住 · 原创演示素材可自由使用"))}</span><span>LOCAL FIRST</span></footer>
    {toast && <div role="status" className={`toast ${error ? 'error' : ''}`}><span>{tr(toast)}</span><button onClick={() => setToast('')} aria-label={tr("关闭提示")}><Icon name="close" size={16}/></button></div>}
    {job && <div className="render-panel"><div className="render-panel-heading"><span><Icon name="export" size={16}/>{job.state === 'done' ? tr("作品已就绪") : job.state === 'error' ? tr("导出失败") : job.state === 'cancelled' ? tr("导出已取消") : tr("正在制作你的音乐影像")}</span>{!rendering && <button onClick={() => setJob(null)} aria-label={tr("关闭导出结果")}><Icon name="close" size={17}/></button>}</div><p>{tr(job.message)}</p>{job.performance && <div className="performance-stats"><b>{job.performance.encoder} · {job.performance.concurrency} {tr("并发")}</b>{job.performance.tunedConcurrency!=null && <span>{tr("本机实测选择")} {job.performance.tunedConcurrency} {tr("并发 · 画质设置保持原值")}</span>}<span>{tr("累计画面")} {job.performance.renderedFps} {tr("fps · 累计编码约")} {job.performance.encodedFps} fps</span>{job.performance.recentRenderedFps != null && <span>{tr("近期画面")} {job.performance.recentRenderedFps} {tr("fps · 近期编码约")} {job.performance.recentEncodedFps ?? "—"} fps</span>}{job.performance.graphics && <span title={job.performance.graphics.renderer || job.performance.graphics.error}>{tr("绘图：")}{job.performance.graphics.software ? tr("软件渲染") : job.performance.graphics.software === false ? tr("硬件合成") : tr("状态未确认")} · {job.performance.graphics.device}</span>}{!!job.diagnostics?.videoReaders.length && <span>{tr("视频背景：")}{job.diagnostics.videoReaders.some(r => r.backend === "frame-cache") ? tr("无损帧缓存") : job.diagnostics.videoReaders.some(r => r.backend === "failed") ? tr("读取失败") : job.diagnostics.videoReaders.some(r => r.backend === "webcodecs") ? (job.diagnostics.videoReaders.some(r => r.backend === "ffmpeg") ? tr("快速 / 兼容混合读取") : tr("快速读取")) : tr("兼容读取")}</span>}{job.performance.parallelEncoding!=null && <span>{tr("工作方式：")}{job.performance.parallelEncoding?tr("画面与编码同时进行"):tr("先生成画面，再编码")}</span>}<span>{tr("已用")} {job.performance.elapsedSeconds} {tr("秒 · 缓存")} {job.performance.cacheMiB} {tr("MB · 解码")} {job.performance.videoThreads} {tr("线程")}</span>{job.performance.fallback && <p>{tr(job.performance.fallback)}</p>}</div>}<div className="job-progress"><div style={{width: `${job.progress * 100}%`}}/></div><div className="job-meta"><span>{Math.round(job.progress * 100)}%</span>{rendering && <button onClick={() => api(`/api/render/${job.id}/cancel`, {}).catch(e => notify(e.message, true))}>{tr("取消导出")}</button>}{window.studio && <button onClick={() => window.studio?.showOutput()}>{tr("打开输出文件夹")}</button>}</div>{job.files.length > 0 && <div className="output-links">{job.files.map(f => <a key={f.url} href={f.url} download>{tr(f.name)}<Icon name="arrow" size={14}/></a>)}</div>}</div>}
    <input hidden ref={audioInput} type="file" accept=".mp3,.wav,.flac,.aac,.m4a" multiple onChange={e => {void importAudio(Array.from(e.target.files ?? [])); e.target.value = '';}}/>
    <input hidden ref={bgInput} type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm" onChange={e => {void importBackground(e.target.files?.[0]); e.target.value = '';}}/>
    <input hidden ref={projectInput} type="file" accept=".json" onChange={e => {const f = e.target.files?.[0]; if (f) void f.text().then(text => open(JSON.parse(text))).catch(err => notify(err.message, true)); e.target.value = '';}}/>
  </div>;
}
