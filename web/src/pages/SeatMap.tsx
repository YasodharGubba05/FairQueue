import { LayoutGrid } from 'lucide-react';
import { PagePlaceholder } from '@/components/layout/PagePlaceholder';

export default function SeatMap() {
  return (
    <PagePlaceholder
      icon={LayoutGrid}
      title="Seat map"
      description="An SVG venue of 2,000 seats with zoom, pan and live held/sold updates. Built in P3."
      phase="P3"
    />
  );
}
