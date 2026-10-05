import React from 'react';
const paths: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14"/>, play: <path d="m8 5 11 7-11 7z"/>, pause: <><path d="M8 5v14M16 5v14"/></>,
  music: <><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></>,
  save: <><path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/></>, folder: <path d="M3 7V4h7l2 3h9v13H3z"/>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 6-6 4 4 3-3 4 5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  export: <><path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/></>, grip: <><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"/></>,
  wide: <rect x="2" y="5" width="20" height="14" rx="2"/>, tall: <rect x="6" y="2" width="12" height="20" rx="2"/>,
  check: <path d="m5 12 4 4 10-10"/>, undo: <><path d="M3 10h12a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5"/></>,
};
export function Icon({name, size = 18}: {name: string; size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.music}</svg>;
}
