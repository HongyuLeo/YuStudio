import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Audio, Sequence, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Project, Orientation} from '../project/model';
import {timeline, cueAt, totalFrames} from '../timeline';
import {progress} from '../animations/motion';
import {Atmosphere} from '../components/Atmosphere';
import {Background} from '../components/Background';
import {NowPlaying} from '../components/NowPlaying';
import {Playlist} from '../components/Playlist';
import {fontFamily} from './fonts';
import type {VideoFrameCaches} from '../project/video-frames';
export type CompositionProps = {project: Project; orientation: Orientation;frameCaches?:VideoFrameCaches};

export function CinematicGlass({project, orientation,frameCaches}: CompositionProps) {
  const frame = useCurrentFrame();
  const {width, fps} = useVideoConfig();
  const cues = useMemo(() => timeline(project), [project]), cue = cueAt(cues, frame);
  const duration = useMemo(() => totalFrames(project), [project]);
  const portrait = orientation === 'portrait';
  const baseW = portrait ? 1080 : 1920, baseH = portrait ? 1920 : 1080;
  const [fontHandle] = useState(() => delayRender('Loading bundled fonts', {timeoutInMilliseconds: 60000}));
  useEffect(() => {
    let alive = true;
    const text = project.name + project.subtitle + project.tracks.map(t => t.title + t.artist).join('');
    Promise.all([document.fonts.load('500 84px "Noto Sans SC"', text), document.fonts.load('400 23px "Noto Sans SC"', text), document.fonts.load('500 14px Inter', 'NOW PLAYING0123456789')])
      .then(() => {if (alive) continueRender(fontHandle);}).catch(cancelRender);
    return () => {alive = false;};
  }, [fontHandle, project.name, project.subtitle, project.tracks]);
  if (!cue) return <AbsoluteFill style={{background: '#152024', alignItems: 'center', justifyContent: 'center', color: '#fff6', fontFamily, fontSize: 48}}>导入音乐，开始创作</AbsoluteFill>;
  const uiOut = 1 - progress(frame, duration - fps * .6, duration);
  return <AbsoluteFill style={{background: '#10171b', overflow: 'hidden', fontFamily}}>
    {cues.map((c, i) => {
      const from = Math.max(0, c.start - Math.round(fps * .24));
      return <Sequence key={`bg-${c.track.id}`} from={from} durationInFrames={c.end - from + Math.round(fps * .8)} premountFor={Math.round(fps * .5)}>
        <Background cue={c} from={from} last={i === cues.length - 1} videoReader={project.render.videoReader} frameCache={c.track.background?frameCaches?.[c.track.background.src]:undefined}/>
      </Sequence>;
    })}
    {cues.map((c, i) => {
      const from = Math.max(0, c.start - Math.round(fps * .24));
      return <Sequence key={`atmosphere-${c.track.id}`} from={from} durationInFrames={c.end - from + Math.round(fps * .8)}>
        <Atmosphere cue={c} from={from} last={i === cues.length - 1} portrait={portrait}/>
      </Sequence>;
    })}
    <div style={{position: 'absolute', width: baseW, height: baseH, transformOrigin: 'top left', transform: `scale(${width / baseW})`, opacity: uiOut, color: '#f7f6ed'}}>
      <div style={{position: 'absolute', width: portrait ? 430 : 350, height: 160, bottom: portrait ? 500 : 100, left: portrait ? 40 : 90, borderRadius: '50%', filter: 'blur(80px)', background: project.accent, opacity: .025 + Math.sin(frame / fps * .7) * .008}}/>
      {cues.map((c, i) => <Sequence key={`text-${c.track.id}`} from={c.start} durationInFrames={c.duration + Math.round(fps * .6)} layout="none">
        <NowPlaying cue={c} portrait={portrait} last={i === cues.length - 1} accent={project.accent} showProgress={project.presentation?.showProgress ?? true}/>
      </Sequence>)}
      {(project.presentation?.showPlaylist ?? true) && <Playlist project={project} cue={cue} frame={frame} portrait={portrait}/>}
    </div>
    {cues.map(c => <Sequence key={`audio-${c.track.id}`} from={c.start} durationInFrames={c.duration}>
      <Audio src={c.track.audio.src} volume={f => Math.min(1, f / Math.max(1, fps * .008), (c.duration - 1 - f) / Math.max(1, fps * .008))}/>
    </Sequence>)}
  </AbsoluteFill>;
}
