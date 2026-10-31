import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore, type ToastTone } from '@/store/toast';
import { cn } from '@/lib/utils';
import { Label } from './label';

const TONE: Record<ToastTone, string> = {
  info: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

const TITLE: Record<ToastTone, string> = {
  info: 'Note',
  success: 'Done',
  warning: 'Heads up',
  error: 'Failed',
};

/**
 * Toasts slide up from the bottom on a hairline-topped panel rather than
 * floating as rounded cards. They carry no icon: the label says what kind of
 * message it is.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-px"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            className="pointer-events-auto w-full border-t bg-surface px-gutter py-4 text-left lg:px-gutter-lg"
          >
            <span className="mx-auto flex max-w-page flex-col gap-1.5">
              <Label className={cn(TONE[toast.tone])}>{TITLE[toast.tone]}</Label>
              <span className="text-sm text-foreground">{toast.title}</span>
              {toast.description ? (
                <span className="text-sm text-muted-foreground">{toast.description}</span>
              ) : null}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
