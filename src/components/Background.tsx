import React, {useCallback, useEffect, useRef} from 'react';
import {Video} from '@remotion/media';
import {AbsoluteFill, Img, Loop, OffthreadVideo, useCurrentFrame, useVideoConfig, useRemotionEnvironment} from 'remotion';
import type {Project} from '../project/model';
import {cachedFrameAt,frameFilename,type VideoFrameCache} from '../project/video-frames';
import type {Cue} from '../timeline';
import {coverPosition} from '../timeline';
import {progress, gentleEase} from '../animations/motion';

function CachedBackground({src,style,cache}:{src:string;style:React.CSSProperties;cache:VideoFrameCache}) {
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  useEffect(()=>{console.log('NOCTURNE_VIDEO:'+JSON.stringify({src,backend:'frame-cache'}));},[src]);
  return <Img src={`${cache.baseSrc}/${frameFilename(cachedFrameAt(cache.timestamps,frame/fps))}`} style={style}/>;
}
function VideoBackground({src, style, reader,cache}: {src:string; style:React.CSSProperties; reader:Project['render']['videoReader'];cache?:VideoFrameCache}) {
  const {isRendering}=useRemotionEnvironment();
  const logged=useRef(false),fallback=useRef(false);
  const report=useCallback((backend:'webcodecs'|'ffmpeg'|'failed',reason?:string)=>{
    if(isRendering)console.log('NOCTURNE_VIDEO:'+JSON.stringify({src,backend,reason}));
  },[isRendering,src]);
  useEffect(()=>{if(reader==='legacy' && !cache)report('ffmpeg','开发验证兼容读取');},[reader,cache,report]);
  const onVideoFrame=useCallback(()=>{
    if(!logged.current && !fallback.current){logged.current=true;report('webcodecs');}
  },[report]);
  const onError=useCallback((error:Error)=>{
    fallback.current=true;report('failed',error.message);return 'fail' as const;
  },[report]);
  if(isRendering && cache)return <CachedBackground src={src} style={style} cache={cache}/>;
  // The historical compositor path is retained only for isolated developer
  // comparisons; normal exports supply the prepared cache for legacy projects.
  return reader==='legacy' ? <OffthreadVideo src={src} muted style={style}/> :
    <Video src={src} muted style={style} objectFit="fill" onVideoFrame={onVideoFrame} onError={onError} disallowFallbackToOffthreadVideo={isRendering} fallbackOffthreadVideoProps={{transparent:false}}/>;
}

export function Background({cue, from, last, videoReader,frameCache}: {cue: Cue; from: number; last: boolean; videoReader?:Project['render']['videoReader'];frameCache?:VideoFrameCache}) {
  const f = useCurrentFrame() + from - cue.start;
  const {fps, width, height} = useVideoConfig();
  const asset = cue.track.background;
  const intro = cue.index === 0 ? 1 : progress(f, -fps * .24, fps * .72, gentleEase);
  const exit = last ? 0 : progress(f, cue.duration, cue.duration + fps * .72, gentleEase);
  const journey = progress(Math.max(0, f), 0, cue.duration, gentleEase);
  // Each shot travels in a single direction. No periodic zoom or mechanical oscillation.
  const zoom = 1.025 + journey * .045 + (1 - intro) * .018 + exit * .015;
  const shiftX = (journey - .5) * width * .009 * (cue.index % 2 ? -1 : 1);
  const shiftY = (journey - .5) * height * .005;
  const box = coverPosition(asset?.width ?? width, asset?.height ?? height, width, height, cue.track.focus.x, cue.track.focus.y);
  const blur = ((1 - intro) * 7 + exit * 5) * width / 1920;
  const style: React.CSSProperties = {position: 'absolute', ...box};
  return <AbsoluteFill style={{opacity: intro, filter: blur > 0 ? `blur(${blur}px)` : undefined, transform: `translate(${shiftX}px, ${shiftY}px) scale(${zoom})`, transformOrigin: '50% 50%'}}>
    {!asset ? <AbsoluteFill style={{background: 'radial-gradient(ellipse at 35% 25%, #415155, #111c21 65%)'}}/> : asset.kind === 'video'
      ? <Loop durationInFrames={Math.max(1, Math.round((asset.duration ?? 1) * fps))}>
          <VideoBackground src={asset.src} style={style} reader={videoReader} cache={frameCache}/>
        </Loop>
      : <Img src={asset.src} style={style}/>}
  </AbsoluteFill>;
}
