'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { fetchFiles } from '@/lib/api-client';
import { PreviewCanvas, primePlaybackAt } from './editor/preview-canvas';
import { Timeline } from './editor/timeline';
import { Inspector } from './editor/inspector';
import { MediaBin } from './editor/media-bin';
import {
  useEditorStore,
  computeTotalDuration,
  loadDoc,
  saveDoc,
  sanitizeRestored,
} from './editor/editor-store';

/**
 * Flagship video editor module.
 * Layout: media bin + preview (left/top), inspector tabs (right), timeline (bottom).
 */
export function EditorModule({ tool }: { tool?: string | null }) {
  // -------------------------------------------------- tool focus from payload
  useEffect(() => {
    const payload = useAppStore.getState().consumePayload();
    const t = tool ?? payload?.tool ?? null;
    if (!t) return;
    const st = useEditorStore.getState();
    switch (t) {
      case 'trim':
        st.setActiveTab('clip');
        st.setHighlight('trim');
        break;
      case 'crop':
        st.setActiveTab('clip');
        st.setHighlight('crop');
        break;
      case 'text':
      case 'title':
      case 'watermark':
        st.setActiveTab(t === 'watermark' ? 'effects' : 'text');
        break;
      case 'audio':
      case 'music':
      case 'voiceover':
      case 'voice':
        st.setActiveTab('audio');
        break;
      case 'effects':
      case 'filter':
      case 'filters':
        st.setActiveTab('effects');
        break;
      case 'export':
      case 'render':
      case 'download':
        st.setActiveTab('export');
        break;
      default:
        st.setActiveTab('clip');
    }
  }, [tool]);

  // ------------------------------------------- restore persisted project once
  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      const doc = loadDoc();
      if (!doc) return;
      const sane = sanitizeRestored(doc);
      const savedCount =
        sane.clips.length + sane.texts.length + sane.overlays.length + sane.audioTracks.length;
      if (savedCount === 0) return;
      try {
        const files = await fetchFiles();
        const byId = new Map(files.map((f) => [f.id, f]));
        const needed = new Set<string>();
        sane.clips.forEach((c) => needed.add(c.fileId));
        sane.audioTracks.forEach((a) => needed.add(a.fileId));
        sane.overlays.forEach((o) => needed.add(o.fileId));
        for (const id of needed) {
          const rec = byId.get(id);
          if (rec) useEditorStore.getState().addSource(rec);
        }
        const ids = new Set(useEditorStore.getState().sources.map((s) => s.file.id));
        const admitted = {
          clips: sane.clips.filter((c) => ids.has(c.fileId)),
          texts: sane.texts,
          overlays: sane.overlays.filter((o) => ids.has(o.fileId)),
          audioTracks: sane.audioTracks.filter((a) => ids.has(a.fileId)),
        };
        const dropped =
          sane.clips.length -
          admitted.clips.length +
          (sane.overlays.length - admitted.overlays.length) +
          (sane.audioTracks.length - admitted.audioTracks.length);
        useEditorStore.getState().admitRestore(sane, admitted);
        if (dropped > 0) {
          toast.info(
            `${dropped} saved item${dropped === 1 ? '' : 's'} dropped — the source file${
              dropped === 1 ? ' is' : 's are'
            } no longer available. Re-add media to rebuild them.`
          );
        } else {
          toast.success('Previous editing session restored.');
        }
      } catch {
        toast.info('Found a saved project, but sources could not be verified. Timeline was restored where possible.');
      }
    })();
  }, []);

  // ------------------------------------------------------ save on change
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (
        s.clips !== prev.clips ||
        s.texts !== prev.texts ||
        s.overlays !== prev.overlays ||
        s.audioTracks !== prev.audioTracks ||
        s.output !== prev.output
      ) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const st = useEditorStore.getState();
          saveDoc(st);
        }, 400);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ---------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useEditorStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        const willPlay = !st.playing;
        st.togglePlay();
        if (willPlay) {
          const total = computeTotalDuration(st.clips);
          if (total > 0) {
            const t = st.playhead >= total - 0.01 ? 0 : st.playhead;
            if (t !== st.playhead) st.setPlayhead(t);
            primePlaybackAt(t);
          }
        }
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        st.splitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedClipId) {
          e.preventDefault();
          st.removeClip(st.selectedClipId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Video Editor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trim, crop, add text, music and effects on a real timeline — preview plays exactly what exports.
        </p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <MediaBin />
          <section aria-label="Preview" className="rounded-xl border bg-card p-4">
            <PreviewCanvas />
          </section>
        </div>
        <aside className="min-w-0" aria-label="Inspector">
          <Inspector />
        </aside>
      </div>

      <section aria-label="Timeline" className="mt-4">
        <Timeline />
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Space play/pause · S split at playhead · Delete removes the selected clip · drag the ruler to scrub
        </p>
      </section>
    </div>
  );
}
