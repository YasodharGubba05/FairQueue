import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70svh] max-w-page flex-col items-start justify-center gap-8 px-gutter lg:px-gutter-lg">
      <Label>404</Label>
      <h1 className="font-display text-display-md">This page does not exist</h1>
      <Button asChild variant="subtle">
        <Link to="/">Back to events</Link>
      </Button>
    </div>
  );
}
