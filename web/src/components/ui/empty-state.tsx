import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One component for every "nothing here" and "that went wrong" panel. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-14 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-12 place-items-center rounded-full',
          tone === 'danger' ? 'bg-danger/15 text-danger' : 'bg-surface-raised text-muted',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
