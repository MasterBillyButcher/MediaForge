'use client';

import { cn } from '@/lib/utils';
import type { FormatOption } from './types';

interface FormatGridProps {
  options: FormatOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the radio group. */
  label: string;
}

/** Radio-style format cards. Responsive: 2 cols mobile, 3 tablet, 6 desktop. */
export function FormatGrid({ options, value, onChange, label }: FormatGridProps) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {options.map((opt) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary'
                : 'border-border hover:border-primary/40 hover:bg-muted/40'
            )}
          >
            <Icon
              className={cn('h-5 w-5', selected ? 'text-primary' : 'text-muted-foreground')}
              aria-hidden
            />
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{opt.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
