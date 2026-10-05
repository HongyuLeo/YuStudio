import type {Project, Track} from '../project/model';
export type Cue = {track: Track; index: number; start: number; duration: number; end: number};
// Round cumulative time, rather than each track: hundreds of fractional durations must not drift.
export function timeline(project: Pick<Project, 'tracks' | 'fps'>): Cue[] {
  let seconds = 0;
  return project.tracks.map((track, index) => {
    const start = Math.round(seconds * project.fps);
    seconds += track.audio.duration;
    const end = Math.max(start + 1, Math.round(seconds * project.fps));
    return {track, index, start, duration: end - start, end};
  });
}
export const totalFrames = (project: Pick<Project, 'tracks' | 'fps'>) => timeline(project).at(-1)?.end ?? 1;
export function cueAt(cues: Cue[], frame: number) {
  return cues.find(c => frame >= c.start && frame < c.end) ?? cues.at(-1);
}
export function timestamp(seconds: number, hours = false) {
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, s = n % 60;
  return (h || hours ? `${String(h).padStart(2, '0')}:` : '') + `${String(h ? m : Math.floor(n / 60)).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function chapters(project: Project) {
  return timeline(project).map(c => `${timestamp(c.start / project.fps)} ${c.track.title}${c.track.artist ? ` — ${c.track.artist}` : ''}`).join('\n') + '\n';
}
export function coverPosition(iw: number, ih: number, vw: number, vh: number, x: number, y: number) {
  const scale = Math.max(vw / iw, vh / ih), w = iw * scale, h = ih * scale;
  // Place the selected source point at viewport center; clamp to avoid exposed edges.
  return {width: w, height: h, left: Math.min(0, Math.max(vw - w, vw / 2 - x * w)),
    top: Math.min(0, Math.max(vh - h, vh / 2 - y * h))};
}
export function playlistWindow(index: number, count: number, capacity: number) {
  return Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, count - capacity));
}
