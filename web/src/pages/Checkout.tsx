import { CreditCard } from 'lucide-react';
import { PagePlaceholder } from '@/components/layout/PagePlaceholder';

export default function Checkout() {
  return (
    <PagePlaceholder
      icon={CreditCard}
      title="Checkout"
      description="Order summary, mock payment and an always-visible hold timer. Built in P3."
      phase="P3"
    />
  );
}
