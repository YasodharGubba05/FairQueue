import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-page px-gutter py-16 lg:px-gutter-lg">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That link does not lead anywhere."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Back to events</Link>
          </Button>
        }
      />
    </div>
  );
}
