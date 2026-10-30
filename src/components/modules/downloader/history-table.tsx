'use client';

import {
  Ban, CheckCircle2, History, RefreshCcw, Trash2, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes } from '@/lib/api-client';
import type { HistoryRecord } from '@/lib/api-client';
import { platformLabel } from './types';

const STATUS_META: Record<string, { icon: LucideIcon; className: string }> = {
  completed: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { icon: XCircle, className: 'text-destructive' },
  unsupported: { icon: Ban, className: 'text-muted-foreground' },
};

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export interface HistoryTableProps {
  history: HistoryRecord[] | null;
  onRefresh: () => void;
  onClear: () => void;
  onDelete: (id: string) => void;
}

export function HistoryTable({ history, onRefresh, onClear, onDelete }: HistoryTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <History className="h-4 w-4 text-primary" aria-hidden /> Download history
          </CardTitle>
          <CardDescription>Last 100 download attempts recorded by the server.</CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} aria-label="Refresh download history">
            <RefreshCcw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={!history || history.length === 0}
            aria-label="Clear download history"
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Clear history
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {history === null ? (
          <div className="space-y-2" aria-label="Loading download history">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
            <History className="mb-2 h-8 w-8 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No downloads yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed, failed and unsupported attempts will be listed here.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border scrollbar-slim">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">URL</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="min-w-[140px]">File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[140px]">Date</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => {
                  const meta = STATUS_META[h.status] ?? STATUS_META.unsupported;
                  const StatusIcon = meta.icon;
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="max-w-[240px] truncate font-mono text-xs" title={h.url}>
                        {h.url}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{platformLabel(h.platform)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs" title={h.fileName ?? undefined}>
                        {h.fileName ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{formatBytes(h.sizeBytes)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(h.status)} className="gap-1 capitalize">
                          <StatusIcon className={`h-3 w-3 ${meta.className}`} aria-hidden />
                          {h.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(h.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onDelete(h.id)}
                          aria-label={`Delete history entry for ${h.url}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
