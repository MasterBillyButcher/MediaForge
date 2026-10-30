'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { Settings as SettingsIcon, Sun, Moon, Trash2, ShieldCheck, Info, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cleanupStorage, formatBytes } from '@/lib/api-client';
import { toast } from 'sonner';

export function SettingsModule() {
  const { resolvedTheme, setTheme } = useTheme();
  const [cleaning, setCleaning] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const runCleanup = async () => {
    setCleaning(true);
    try {
      const removed = await cleanupStorage();
      toast.success(`Cleanup complete — removed ${removed} expired file${removed === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cleanup failed.');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2 mb-8">
        <SettingsIcon className="h-6 w-6 text-primary" aria-hidden /> Settings
      </h1>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {resolvedTheme === 'dark' ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
              Appearance
            </CardTitle>
            <CardDescription>Dark and light themes are supported across every tool.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Label htmlFor="theme-switch" className="text-sm font-normal">
              {resolvedTheme === 'dark' ? 'Dark mode is on' : 'Light mode is on'}
            </Label>
            <Switch
              id="theme-switch"
              checked={resolvedTheme === 'dark'}
              onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trash2 className="h-4 w-4" aria-hidden /> Storage &amp; Privacy
            </CardTitle>
            <CardDescription>
              Uploads auto-expire after 6 hours and processing results after 3 hours. A background sweeper deletes expired files continuously.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Run cleanup now</p>
                <p className="text-xs text-muted-foreground">Immediately delete every expired temporary file.</p>
              </div>
              <Button variant="outline" onClick={() => void runCleanup()} disabled={cleaning}>
                <Trash2 className="h-4 w-4 mr-1.5" aria-hidden /> {cleaning ? 'Cleaning…' : 'Clean now'}
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Auto-play previews</p>
                <p className="text-xs text-muted-foreground">Play file previews automatically in tool cards.</p>
              </div>
              <Switch checked={autoPlay} onCheckedChange={setAutoPlay} aria-label="Auto-play previews" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Reduce motion</p>
                <p className="text-xs text-muted-foreground">Minimize non-essential interface animation.</p>
              </div>
              <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} aria-label="Reduce motion" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Security &amp; Limits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">250 MB</Badge> maximum upload size per file.
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">600 MB</Badge> maximum size for remote URL downloads.
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">15 min</Badge> processing timeout per job.
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">SSRF-guarded</Badge> URLs are validated — private/internal addresses are blocked.
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="mt-0.5 shrink-0">Rate-limited</Badge> processing endpoints are protected against abuse.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" aria-hidden /> Processing Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              FFmpeg server-side pipeline with a 2-job concurrent queue — the web server never blocks.
            </p>
            <p className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Progress is parsed from the encoder itself — no simulated percentages anywhere.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
