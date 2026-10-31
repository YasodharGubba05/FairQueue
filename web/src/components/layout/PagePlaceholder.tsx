import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Every route exists from P0 so the shell and navigation are real; each page is
 * filled in by the phase named here.
 */
export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="mx-auto flex max-w-page flex-col items-start gap-4 px-gutter py-16 lg:px-gutter-lg">
      <span className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-accent to-highlight text-accent-foreground shadow-glow">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-display-sm sm:text-display-md">{title}</h1>
        <Badge variant="accent">{phase}</Badge>
      </div>
      <p className="max-w-prose text-muted">{description}</p>
    </div>
  );
}
