import { Activity } from 'lucide-react';
import { PagePlaceholder } from '@/components/layout/PagePlaceholder';

export default function MissionControl() {
  return (
    <PagePlaceholder
      icon={Activity}
      title="Mission Control"
      description="Live tiles and charts for queue depth, admissions, purchases, seats left, api pods, oversold seats and blocked requests. Built in P4 and P6."
      phase="P4"
    />
  );
}
