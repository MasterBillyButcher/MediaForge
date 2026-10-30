'use client';

import { create } from 'zustand';
import { useEffect } from 'react';

export type ViewId =
  | 'home'
  | 'playlist'
  | 'downloader'
  | 'universal'
  | 'converter'
  | 'audio-converter'
  | 'editor'
  | 'image-tools'
  | 'audio-tools'
  | 'subtitle-tools'
  | 'files'
  | 'settings';

export interface NavigationPayload {
  url?: string; // prefill for downloader
  tool?: string; // preselect a tool/mode (e.g. 'trim', 'crop', 'gif-maker')
  fileId?: string; // send a file to a module (e.g. webm -> converter)
  fileName?: string;
}

interface AppState {
  view: ViewId;
  payload: NavigationPayload | null;
  navigate: (view: ViewId, payload?: NavigationPayload) => void;
  consumePayload: () => NavigationPayload | null;
  setViewFromHash: () => void;
}

function viewFromHash(): ViewId {
  const h = window.location.hash.replace(/^#\/?/, '');
  const valid: ViewId[] = ['home', 'playlist', 'downloader', 'universal', 'converter', 'audio-converter', 'editor', 'image-tools', 'audio-tools', 'subtitle-tools', 'files', 'settings'];
  return (valid.includes(h as ViewId) ? h : 'home') as ViewId;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'home',
  payload: null,
  navigate: (view, payload) => {
    set({ view, payload: payload ?? null });
    if (typeof window !== 'undefined') {
      window.location.hash = view === 'home' ? '/' : `/${view}`;
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  },
  consumePayload: () => {
    const p = get().payload;
    if (p) set({ payload: null });
    return p;
  },
  setViewFromHash: () => {
    if (typeof window === 'undefined') return;
    set({ view: viewFromHash() });
  },
}));

/** Global hashchange listener — mount once in the app shell. */
export function useHashRouting(): void {
  useEffect(() => {
    const onHash = () => useAppStore.getState().setViewFromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
}
