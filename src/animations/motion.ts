import {Easing, interpolate, spring} from 'remotion';
export const cinematicEase = Easing.bezier(0.22, 1, 0.36, 1);
export const gentleEase = Easing.bezier(0.45, 0, 0.55, 1);
export const progress = (frame: number, from: number, to: number, ease = cinematicEase) =>
  interpolate(frame, [from, Math.max(from + 1, to)], [0, 1], {easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
export const settle = (frame: number, fps: number) => spring({frame: Math.max(0, frame), fps, config: {damping: 26, stiffness: 160, mass: 0.85}, durationInFrames: Math.round(fps * 0.8)});
