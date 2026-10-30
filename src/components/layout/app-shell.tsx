'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Download, RefreshCcw, Scissors, ImageIcon, FileAudio, Captions, FolderOpen,
  Settings, Sun, Moon, Menu, Globe, AudioLines, Film, Hammer, ListMusic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppStore, useHashRouting, type ViewId } from '@/lib/store';
import { cn } from '@/lib/utils';

const NAV_MAIN: Array<{ id: ViewId; label: string; icon: typeof Download }> = [
  { id: 'home', label: 'Home', icon: Globe },
  { id: 'playlist', label: 'Playlist Downloader', icon: ListMusic },
  { id: 'downloader', label: 'Video Downloader', icon: Download },
  { id: 'universal', label: 'Universal Downloader', icon: Download },
];

const NAV_CONVERT: Array<{ id: ViewId; label: string; icon: typeof Download }> = [
  { id: 'converter', label: 'Video Converter', icon: Film },
  { id: 'audio-converter', label: 'Audio Converter', icon: AudioLines },
];

const NAV_TOOLS: Array<{ id: ViewId; label: string; icon: typeof Download }> = [
  { id: 'image-tools', label: 'Image Tools', icon: ImageIcon },
  { id: 'audio-tools', label: 'Audio Tools', icon: FileAudio },
  { id: 'subtitle-tools', label: 'Subtitle Tools', icon: Captions },
];

/** Returns false during SSR/hydration, true on the client after mount. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useHashRouting();
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (id: ViewId) => {
    navigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-2 focus:rounded-md"
      >
        Skip to content
      </a>

      <header
        className={cn(
          'sticky top-0 z-40 w-full border-b backdrop-blur-xl transition-colors',
          scrolled ? 'bg-background/85 border-border' : 'bg-background/60 border-transparent'
        )}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <button
            onClick={() => go('home')}
            className="flex items-center gap-2 shrink-0 group"
            aria-label="MediaForge home"
          >
            <span className="brand-gradient-bg flex h-9 w-9 items-center justify-center rounded-xl shadow-lg shadow-primary/20 transition-transform group-hover:scale-105">
              <Hammer className="h-5 w-5 text-white" aria-hidden />
            </span>
            <span className="text-lg font-bold tracking-tight">
              Media<span className="brand-gradient-text">Forge</span>
            </span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 ml-4" aria-label="Main navigation">
            {NAV_MAIN.map((item) => (
              <Button key={item.id} variant={view === item.id ? 'secondary' : 'ghost'} size="sm" onClick={() => go(item.id)} className="font-medium">
                <item.icon className="h-4 w-4 mr-1.5" aria-hidden />
                {item.label}
              </Button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={view === 'converter' || view === 'audio-converter' ? 'secondary' : 'ghost'} size="sm" className="font-medium">
                  <RefreshCcw className="h-4 w-4 mr-1.5" aria-hidden />
                  Converters
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {NAV_CONVERT.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => go(item.id)}>
                    <item.icon className="h-4 w-4 mr-2" /> {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant={view === 'editor' ? 'secondary' : 'ghost'} size="sm" onClick={() => go('editor')} className="font-medium">
              <Scissors className="h-4 w-4 mr-1.5" aria-hidden />
              Editor
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="font-medium">
                  <Hammer className="h-4 w-4 mr-1.5" aria-hidden />
                  More Tools
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {NAV_TOOLS.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => go(item.id)}>
                    <item.icon className="h-4 w-4 mr-2" /> {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => go('files')}
              className="hidden md:inline-flex"
            >
              <FolderOpen className="h-4 w-4 mr-1.5" aria-hidden />
              My Files
            </Button>
            <Button variant="ghost" size="icon" onClick={() => go('settings')} aria-label="Settings" className="hidden md:inline-flex">
              <Settings className="h-5 w-5" />
            </Button>
            <ThemeToggle />
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 overflow-y-auto">
                <SheetTitle className="flex items-center gap-2">
                  <span className="brand-gradient-bg flex h-8 w-8 items-center justify-center rounded-lg">
                    <Hammer className="h-4 w-4 text-white" aria-hidden />
                  </span>
                  MediaForge
                </SheetTitle>
                <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile navigation">
                  {[...NAV_MAIN, ...NAV_CONVERT, { id: 'editor' as ViewId, label: 'Video Editor', icon: Scissors }, ...NAV_TOOLS, { id: 'files' as ViewId, label: 'My Files', icon: FolderOpen }, { id: 'settings' as ViewId, label: 'Settings', icon: Settings }].map((item) => (
                    <Button
                      key={item.id}
                      variant={view === item.id ? 'secondary' : 'ghost'}
                      className="justify-start"
                      onClick={() => go(item.id)}
                    >
                      <item.icon className="h-4 w-4 mr-2" aria-hidden />
                      {item.label}
                    </Button>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 w-full">
        {children}
      </main>

      <footer className="mt-auto border-t bg-card/50 w-full">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="brand-gradient-bg flex h-8 w-8 items-center justify-center rounded-lg">
                  <Hammer className="h-4 w-4 text-white" aria-hidden />
                </span>
                <span className="font-bold">MediaForge</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Everything you need for video &amp; media. Download, convert, edit, compress and manage — all in one place.
              </p>
            </div>
            <nav aria-label="Footer download tools">
              <h3 className="text-sm font-semibold mb-3">Download</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('playlist')}>Playlist Downloader</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('downloader')}>Video Downloader</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('universal')}>Universal Downloader</button></li>
              </ul>
            </nav>
            <nav aria-label="Footer convert tools">
              <h3 className="text-sm font-semibold mb-3">Convert &amp; Edit</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('converter')}>Video Converter</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('audio-converter')}>Audio Converter</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('editor')}>Video Editor</button></li>
              </ul>
            </nav>
            <nav aria-label="Footer additional tools">
              <h3 className="text-sm font-semibold mb-3">More Tools</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('image-tools')}>Image Tools</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('audio-tools')}>Audio Tools</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('subtitle-tools')}>Subtitle Tools</button></li>
                <li><button className="hover:text-foreground transition-colors" onClick={() => go('files')}>My Files</button></li>
              </ul>
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t text-xs text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between">
            <p>© {new Date().getFullYear()} MediaForge. Process only media you own or are authorized to use.</p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              Real FFmpeg-powered processing — no fake progress bars.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
