import {readLanguage} from '../i18n';
import {translateText} from '../i18n/messages';
import type {Asset, Project, Track} from './model';
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await res.json(); if (!res.ok) throw new Error(translateText(data.error || '本地服务暂时不可用。', readLanguage())); return data as T;
}
export async function upload(files: File[], kind: 'audio' | 'background') {
  const form = new FormData(); form.append('kind', kind);
  for (const file of files) form.append('files', file);
  const res = await fetch('/api/import', {method: 'POST', body: form});
  const data = await res.json(); if (!res.ok) throw new Error(translateText(data.error || '导入失败。', readLanguage()));
  return data.results as {name: string; asset?: Asset; track?: Track; error?: string}[];
}
export const assetUrl = (src?: string) => !src ? undefined : src.startsWith('demo/') ? `/${src}` : `/media/${src.slice(7)}`;
export function previewProject(p: Project): Project {
  return {...p, tracks: p.tracks.map(t => ({...t, audio: {...t.audio, src: assetUrl(t.audio.src)!}, background: t.background ? {...t.background, src: assetUrl(t.background.src)!} : undefined}))};
}
declare global {interface Window {studio?: {getLanguage(): Promise<'zh-CN' | 'en' | null>; setLanguage(language: 'zh-CN' | 'en'): Promise<void>; showOutput(): Promise<void>; saveProject(project: Project): Promise<{ok?: boolean; cancelled?: boolean}>; openProject(): Promise<unknown>}}}
