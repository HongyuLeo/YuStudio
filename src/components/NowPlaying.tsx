import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {progress, settle} from '../animations/motion';
import {timestamp, type Cue} from '../timeline';

export function NowPlaying({cue, portrait, last, accent, showProgress}: {cue: Cue; portrait: boolean; last: boolean; accent: string; showProgress: boolean}) {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = (delay: number) => settle(f - delay * fps, fps);
  const exit = last ? 0 : progress(f, cue.duration, cue.duration + fps * .45);
  const visual = (delay: number): React.CSSProperties => {
    const p = enter(delay), blur = Math.max(0, (1 - p) * 7 + exit * 6);
    return {opacity: Math.min(1, p) * (1 - exit), transform: `translateY(${(1 - p) * 18 - exit * 12}px)`, filter: blur > 0 ? `blur(${blur}px)` : undefined};
  };
  const elapsed = Math.min(cue.track.audio.duration, Math.max(0, f / fps));
  const ratio = Math.min(1, Math.max(0, f / Math.max(1, cue.duration - 1)));
  const width = portrait ? 710 : 680;
  const title = cue.track.title;
  const artist = cue.track.artist.trim();
  const titleSize = title.length > 18 ? 34 : portrait ? 48 : 52;
  return <div style={{position: 'absolute', left: portrait ? 64 : 76, top: portrait ? 1640 : 848, width, color: '#fafaf6', textShadow: '0 1px 3px #000, 0 2px 9px #000b'}}>
    <div style={{...visual(0), display: 'flex', gap: 10, alignItems: 'center', color: '#ffffffe0', fontSize: portrait ? 14 : 11, letterSpacing: '2px', fontWeight: 500}}>
      <span style={{width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 18px ${accent}88`}}/>
      NOW PLAYING <span style={{letterSpacing: 1, color: '#ffffff5c', marginLeft: 12}}>{String(cue.index + 1).padStart(2, '0')}</span>
    </div>
    <div style={{...visual(.04), marginTop: 14, position: 'relative', padding: '10px 18px', width: 'fit-content', maxWidth: '100%'}}>
      <span style={{position: 'absolute', left: 0, top: 0, width: 48 + enter(.04) * 24, height: 15, borderTop: '1px solid #ffffffcc', borderLeft: '1px solid #ffffffcc', filter: 'drop-shadow(0 1px 2px #000)'}}/>
      <span style={{position: 'absolute', right: 0, bottom: 0, width: 48 + enter(.08) * 24, height: 15, borderBottom: '1px solid #ffffffcc', borderRight: '1px solid #ffffffcc', filter: 'drop-shadow(0 1px 2px #000)'}}/>
      <div style={{fontSize: titleSize, lineHeight: 1.2, fontWeight: 400, letterSpacing: '-1px', textShadow: '0 2px 3px #000b, 0 8px 26px #0008', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{title}</div>
    </div>
    {artist && <div style={{...visual(.12), marginTop: 10, color: '#ffffffe0', fontSize: portrait ? 20 : 17, letterSpacing: '.5px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'}}>{artist}</div>}
    {showProgress && <div style={{...visual(.16), marginTop: artist ? 23 : 16}}>
      <div style={{height: 2, position: 'relative', background: '#ffffff75', borderRadius: 2, boxShadow: '0 1px 3px #0007'}}>
        <div style={{position: 'absolute', left: 0, top: 0, height: 2, width: `${ratio * 100}%`, borderRadius: 2, background: '#fff', boxShadow: `0 0 12px ${accent}30`}}/>
        <div style={{position: 'absolute', left: `${ratio * 100}%`, top: -2, width: 6, height: 6, borderRadius: '50%', background: '#fff', transform: 'translateX(-50%)', boxShadow: '0 0 8px #0008'}}/>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: portrait ? 15 : 12, color: '#ffffffd9', fontVariantNumeric: 'tabular-nums', letterSpacing: '1px'}}>
        <span>{timestamp(elapsed)}</span><span>{timestamp(cue.track.audio.duration)}</span>
      </div>
    </div>}
  </div>;
}
