import { Settings } from 'lucide-react';
import { PagePlaceholder } from '@/components/layout/PagePlaceholder';

export default function Admin() {
  return (
    <PagePlaceholder
      icon={Settings}
      title="Admin"
      description="Create an event from a sections x rows x seats generator, and pause or resume the queue. Built in P6."
      phase="P6"
    />
  );
}
