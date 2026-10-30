'use client';

import { Suspense, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { HomeModule } from '@/components/modules/home';
import { FilesModule } from '@/components/modules/files';
import { SettingsModule } from '@/components/modules/settings';
import { ConverterModule } from '@/components/modules/converter';
import { DownloaderModule } from '@/components/modules/downloader';
import { PlaylistModule } from '@/components/modules/playlist';
import { EditorModule } from '@/components/modules/editor';
import { ImageToolsModule, AudioToolsModule, SubtitleToolsModule } from '@/components/modules/toolbox';
import { useAppStore } from '@/lib/store';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 space-y-6">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function Router() {
  const view = useAppStore((s) => s.view);
  const payload = useAppStore((s) => s.payload);
  // consume one-shot payloads lazily inside each module; pass current values
  switch (view) {
    case 'playlist':
      return <PlaylistModule initialUrl={payload?.url} />;
    case 'downloader':
      return <DownloaderModule mode="video" key="dl" initialUrl={payload?.url} />;
    case 'universal':
      return <DownloaderModule mode="universal" key="un" initialUrl={payload?.url} />;
    case 'converter':
      return <ConverterModule mode="video" key="cv" initialTool={payload?.tool} />;
    case 'audio-converter':
      return <ConverterModule mode="audio" key="ac" initialTool={payload?.tool} />;
    case 'editor':
      return <EditorModule key="ed" tool={payload?.tool ?? null} />;
    case 'image-tools':
      return <ImageToolsModule key="it" />;
    case 'audio-tools':
      return <AudioToolsModule key="at" />;
    case 'subtitle-tools':
      return <SubtitleToolsModule key="st" />;
    case 'files':
      return <FilesModule />;
    case 'settings':
      return <SettingsModule />;
    case 'home':
    default:
      return <HomeModule />;
  }
}

export default function Page() {
  const setViewFromHash = useAppStore((s) => s.setViewFromHash);

  useEffect(() => {
    setViewFromHash();
  }, [setViewFromHash]);

  return (
    <AppShell>
      <Suspense fallback={<LoadingFallback />}>
        <Router />
      </Suspense>
    </AppShell>
  );
}
