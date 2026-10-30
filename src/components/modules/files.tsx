'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Trash2, Download, RefreshCcw, HardDrive, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDurationClient, CategoryIcon } from '@/components/shared/dropzone';
import { fetchFiles, deleteFile, fetchHistory, deleteHistory, fileUrl, formatBytes } from '@/lib/api-client';
import type { MediaFileRecord } from '@/lib/types';
import type { HistoryRecord } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

function timeLeft(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function FilesModule() {
  const [files, setFiles] = useState<MediaFileRecord[] | null>(null);
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const navigate = useAppStore((s) => s.navigate);

  const load = useCallback(async () => {
    try {
      const [f, h] = await Promise.all([fetchFiles(), fetchHistory()]);
      setFiles(f);
      setHistory(h);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load files.');
      setFiles([]);
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await new Promise((r) => setTimeout(r, 0)); // defer out of the effect body
      if (!cancelled) await load();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const removeFile = async (id: string) => {
    try {
      await deleteFile(id);
      setFiles((prev) => prev?.filter((f) => f.id !== id) ?? null);
      toast.success('File deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const clearHistory = async () => {
    await deleteHistory();
    setHistory([]);
    toast.success('Download history cleared.');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" aria-hidden /> My Files
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Temporary storage — uploads, processing results and downloads. Everything auto-expires.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCcw className="h-4 w-4 mr-1.5" aria-hidden /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="files">
        <TabsList className="mb-6">
          <TabsTrigger value="files">Files ({files?.length ?? '…'})</TabsTrigger>
          <TabsTrigger value="downloads">Download History ({history?.length ?? '…'})</TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          {files === null ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : files.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <HardDrive className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" aria-hidden />
                <p className="font-medium">No files yet</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">Upload something in any tool and it will appear here.</p>
                <Button onClick={() => navigate('converter')}>Open the Converter</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 max-h-[36rem] overflow-y-auto scrollbar-slim pr-1">
              {files.map((f) => {
                return (
                  <Card key={f.id}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        <CategoryIcon mime={f.mime} name={f.originalName} className="h-5 w-5 text-primary" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.originalName}</p>
                        <p className="text-xs text-muted-foreground flex flex-wrap gap-x-2 mt-0.5">
                          <span>{formatBytes(f.sizeBytes)}</span>
                          {f.meta && f.meta.duration > 0 && <span>· {formatDurationClient(f.meta.duration)}</span>}
                          {f.meta && f.meta.width > 0 && <span>· {f.meta.width}×{f.meta.height}</span>}
                          <span>· {f.kind}</span>
                          {f.operation && <span>· {f.operation}</span>}
                        </p>
                      </div>
                      <Badge variant="secondary" className="hidden sm:inline-flex shrink-0 gap-1">
                        <Clock3 className="h-3 w-3" aria-hidden /> {timeLeft(f.expiresAt)}
                      </Badge>
                      <Button asChild variant="outline" size="icon" aria-label={`Download ${f.originalName}`}>
                        <a href={fileUrl(f.id)} download><Download className="h-4 w-4" /></a>
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${f.originalName}`} onClick={() => void removeFile(f.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="downloads">
          {history === null ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
            </div>
          ) : history.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <Download className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" aria-hidden />
                <p className="font-medium">No downloads yet</p>
                <p className="text-sm text-muted-foreground mt-1">URL downloads will be listed here.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Download History</CardTitle>
                  <CardDescription>Last 100 URL downloads on this server.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void clearHistory()}>
                  <Trash2 className="h-4 w-4 mr-1.5" aria-hidden /> Clear
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto scrollbar-slim">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[220px]">URL</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="min-w-[130px]">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="max-w-[260px] truncate text-xs font-mono" title={h.url}>{h.url}</TableCell>
                          <TableCell><Badge variant="outline">{h.platform}</Badge></TableCell>
                          <TableCell className="max-w-[160px] truncate text-xs">{h.fileName ?? '—'}</TableCell>
                          <TableCell className="text-xs">{formatBytes(h.sizeBytes)}</TableCell>
                          <TableCell>
                            <Badge variant={h.status === 'completed' ? 'secondary' : 'destructive'} className="capitalize">{h.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(h.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
