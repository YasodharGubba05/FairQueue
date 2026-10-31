import { Label } from '@/components/ui/label';

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-page flex-col gap-3 px-gutter py-10 lg:flex-row lg:items-center lg:justify-between lg:px-gutter-lg">
        <Label>FairQueue</Label>
        <p className="max-w-reading text-xs leading-relaxed text-faint">
          A portfolio project. Payment is simulated and no real tickets are sold.
        </p>
      </div>
    </footer>
  );
}
