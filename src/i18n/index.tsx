import React, {createContext, useContext, useEffect, useState} from 'react';
import {translateText, type Language} from './messages';
export const languageKey = 'yustudio.language';
export function readLanguage(): Language {
  try {return localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh-CN';} catch {return 'zh-CN';}
}
const Context = createContext({language: 'zh-CN' as Language, setLanguage: (_language: Language) => {}, t: (text: string) => text});
export function LanguageProvider({children}: {children: React.ReactNode}) {
  const [language, setCurrentLanguage] = useState<Language>(readLanguage);
  const setLanguage = (next: Language) => {
    setCurrentLanguage(next); localStorage.setItem(languageKey, next);
    void window.studio?.setLanguage(next).catch(() => {});
  };
  useEffect(() => {void window.studio?.getLanguage().then(saved => {
    if (saved === 'en' || saved === 'zh-CN') {setCurrentLanguage(saved); localStorage.setItem(languageKey, saved);}
  }).catch(() => {});}, []);
  useEffect(() => {document.documentElement.lang = language; document.title = language === 'en' ? 'YuStudio · Music video studio' : 'YuStudio · 音乐影像工作室';}, [language]);
  return <Context.Provider value={{language, setLanguage, t: text => translateText(text, language)}}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);
