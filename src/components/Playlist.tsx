import React from 'react';
import {useVideoConfig} from 'remotion';
import type {Project} from '../project/model';
import {playlistWindow, timestamp, type Cue} from '../timeline';
import {settle} from '../animations/motion';

export function Playlist({project, cue, frame, portrait}: {project: Project; cue: Cue; frame: number; portrait: boolean}) {
  const {fps} = useVideoConfig();
  const capacity = portrait ? 5 : 7;
  const rows = Math.min(capacity, project.tracks.length), rowH = 44;
  const oldIndex = Math.max(0, cue.index - 1);
  const previousWindow = playlistWindow(oldIndex, project.tracks.length, capacity);
  const nextWindow = playlistWindow(cue.index, project.tracks.length, capacity);
  const p = settle(frame - cue.start - .15 * fps, fps);
  const movingIndex = oldIndex + (cue.index - oldIndex) * p;
  const window = previousWindow + (nextWindow - previousWindow) * p;
  const width = portrait ? 360 : 300;
  const intro = Math.min(1, settle(frame - .18 * fps, fps));
  return <div style={{position: 'absolute', left: portrait ? 650 : 1540, top: portrait ? 88 : 1020 - rows * rowH - 40, width, opacity: intro, transform: `translateY(${(1 - intro) * 18}px)`, textShadow: '0 1px 3px #000, 0 2px 8px #000b'}}>
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, color: '#ffffffd9', fontSize: portrait ? 12 : 10, letterSpacing: '2px'}}><span>PLAYLIST</span><span style={{letterSpacing: '1px'}}>{String(project.tracks.length).padStart(2, '0')}</span></div>
    <div style={{position: 'relative', height: rows * rowH, overflow: 'hidden', borderTop: '1px solid #ffffff55'}}>
      <div style={{position: 'absolute', top: (movingIndex - window) * rowH + 3, left: 0, width: 2, height: rowH - 6, background: '#fff', boxShadow: '0 1px 4px #0007'}}/>
      <div style={{transform: `translateY(${-window * rowH}px)`}}>
        {project.tracks.map((track, i) => {
          const active = Math.max(0, 1 - Math.abs(i - movingIndex));
          return <div key={track.id} style={{height: rowH, display: 'flex', alignItems: 'center', gap: 11, padding: '0 10px', position: 'relative'}}>
            <div style={{width: 22, fontSize: portrait ? 14 : 11, color: '#ffffffb3', fontVariantNumeric: 'tabular-nums', flexShrink: 0}}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{flex: 1, minWidth: 0, opacity: .72 + active * .28}}>
              <div style={{fontSize: portrait ? 21 : 16, fontWeight: active > .5 ? 500 : 400, color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'}}>{track.title}</div>
            </div>
            <span style={{color: '#ffffffd9', fontSize: portrait ? 13 : 10, fontVariantNumeric: 'tabular-nums'}}>{timestamp(track.audio.duration)}</span>
            <span style={{opacity: active, color: '#fff', fontSize: 10}}>▶</span>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
