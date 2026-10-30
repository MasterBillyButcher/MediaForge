'use client';

import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ToolCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick?: () => void;
  href?: string;
  badge?: string;
  className?: string;
}

export function ToolCard({ icon: Icon, title, description, onClick, href, badge, className }: ToolCardProps) {
  const inner = (
    <Card className={cn(
      'group h-full transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 cursor-pointer',
      className
    )}>
      <CardContent className="p-5 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          {badge && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        <h3 className="font-semibold text-sm sm:text-base mb-1">{title}</h3>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed flex-1">{description}</p>
        <span className="mt-3 inline-flex items-center text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Open tool <ArrowRight className="h-3 w-3 ml-1" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <a href={href} className="block h-full focus-visible:outline-none" onClick={(e) => { if (onClick) { e.preventDefault(); onClick(); } }}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={onClick} className="block w-full h-full text-left focus-visible:outline-none" aria-label={title}>
      {inner}
    </button>
  );
}

export function SectionHeading({ title, subtitle, id }: { title: string; subtitle?: string; id?: string }) {
  return (
    <div id={id} className="mb-6 sm:mb-8">
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm sm:text-base text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}
