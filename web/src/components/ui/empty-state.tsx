import { cn } from '@/lib/utils';
import { Label } from './label';

/**
 * Every "nothing here" and "that went wrong" panel. No dashed box, no icon in
 * a circle: a label, a line of text, and the way out.
 */
export function EmptyState({
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-5 py-20', className)}>
      <Label tone={tone === 'danger' ? 'danger' : 'muted'}>
        {tone === 'danger' ? 'Something went wrong' : 'Nothing here'}
      </Label>
      <h2 className="max-w-reading font-display text-display-sm">{title}</h2>
      {description ? (
        <p className="max-w-reading text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
