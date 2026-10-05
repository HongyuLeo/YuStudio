import React from 'react';
import {Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Cue} from '../timeline';
import {gentleEase, progress} from '../animations/motion';
import atlas from './atmosphere-atlas.json';

const seed = (i: number, salt: number) => {const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return n - Math.floor(n);};
const wrap = (n: number) => ((n % 1) + 1) % 1;
// The appearance is baked from the original Chromium CSS at 2x. Each frame
// moves cached pixels instead of rerasterizing 72 blurs and 144 glow shadows.
const particles = atlas.particles.map(p => ({...p, speed: (p.depth === 0 ? .014 : p.depth === 1 ? .031 : .052) * (.6 + seed(p.id, 2)),
  phase: seed(p.id, 3), x: seed(p.id, 4), sway: .3 + seed(p.id, 5) * .2, angle: seed(p.id, 6) * 360}));
const spriteStyle = (p: {sx: number; sy: number; cell: number; size: number}, height: number, src: string): React.CSSProperties => ({
  position: 'absolute', left: -(p.cell - p.size) / 2, top: -(p.cell - height) / 2, width: p.cell, height: p.cell,
  backgroundImage: `url("${src}")`, backgroundSize: `${atlas.width}px ${atlas.height}px`, backgroundPosition: `${-p.sx}px ${-p.sy}px`, backgroundRepeat: 'no-repeat',
});
export function Atmosphere({cue, from, last, portrait}: {cue: Cue; from: number; last: boolean; portrait: boolean}) {
  const local = useCurrentFrame();
  const {width, fps} = useVideoConfig();
  const frame = local + from, f = frame - cue.start, seconds = frame / fps;
  const preset = cue.track.atmosphere?.preset ?? 'embers', amount = cue.track.atmosphere?.amount ?? .65;
  if (preset === 'none' || amount === 0) return null;
  const w = portrait ? 1080 : 1920, h = portrait ? 1920 : 1080;
  const enter = cue.index === 0 ? 1 : progress(f, -fps * .24, fps * .72, gentleEase);
  const leave = last ? 1 : 1 - progress(f, cue.duration, cue.duration + fps * .72, gentleEase);
  const warm = preset === 'embers', snow = preset === 'snow', orientation = portrait ? 'portrait' : 'landscape';
  const src = staticFile(`atmosphere/${preset}-sprites.png`);
  return <div data-atmosphere={preset} aria-hidden style={{position: 'absolute', left: 0, top: 0, width: w, height: h,
    transformOrigin: 'top left', transform: `scale(${width / w})`, opacity: enter * leave * amount, pointerEvents: 'none'}}>
    {/* Img ensures sprites are loaded before a frame can be captured. */}
    <Img src={src} style={{position:'absolute',width:1,height:1,visibility:'hidden'}}/>
    <div style={{position: 'absolute', width: w * 1.35, height: h * .72, left: -w * .2, top: h * .28,
      transform: `translate(${Math.sin(seconds * .11) * 65}px, ${Math.cos(seconds * .13) * 24}px) rotate(-12deg)`}}>
      <Img src={staticFile(`atmosphere/${preset}-${orientation}-mist.png`)} style={{position:'absolute',left:-128,top:-128,width:Math.ceil(w*1.35+256),height:Math.ceil(h*.72+256)}}/>
    </div>
    <div style={{position: 'absolute', left: w * .13, top: -h * .25, width: w * .66, height: h * 1.3,
      transform: `rotate(${20 + Math.sin(seconds * .09) * 4}deg)`, opacity: .35 + Math.sin(seconds * .23) * .09}}>
      <Img src={staticFile(`atmosphere/${preset}-${orientation}-beam.png`)} style={{position:'absolute',left:-88,top:-88,width:Math.ceil(w*.66+176),height:Math.ceil(h*1.3+176)}}/>
    </div>
    {particles.map(p => {
      const {id, depth, size} = p, phase = wrap(p.phase + seconds * p.speed);
      const fade = Math.sin(Math.PI * phase) ** .6;
      const x = p.x * (w + 180) - 90 + Math.sin(seconds * p.sway + id) * (depth === 2 ? 55 : 22) + phase * 85;
      const y = snow ? phase * (h + 160) - 80 : (1 - phase) * (h + 160) - 80;
      const pulse = warm || snow ? 1 : .55 + .45 * Math.sin(seconds * 1.6 + id) ** 2;
      const height = size * (warm ? 1.55 : 1);
      return <div key={id} style={{position:'absolute',left:0,top:0,width:size,height,
        opacity: fade * pulse * (depth === 0 ? .42 : depth === 1 ? .75 : .4),
        transform:`translate(${x}px, ${y}px) rotate(${p.angle + seconds * (warm ? 28 : 9)}deg)`}}>
        <div style={spriteStyle(p,height,src)}/>
      </div>;
    })}
    {atlas.bokeh.map(p => {
      const x = (p.id % 2 ? .95 : .025) * w + Math.sin(seconds * .14 + p.id * 2) * 50;
      const y = wrap(seed(p.id, 21) + seconds * .009) * (h + 240) - 120;
      return <div key={`bokeh-${p.id}`} style={{position:'absolute',left:0,top:0,width:p.size,height:p.size,
        transform:`translate(${x-p.size/2}px, ${y}px)`,opacity:.55}}><div style={spriteStyle(p,p.size,src)}/></div>;
    })}
  </div>;
}
