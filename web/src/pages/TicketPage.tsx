import { QrCode } from 'lucide-react';
import { PagePlaceholder } from '@/components/layout/PagePlaceholder';

export default function TicketPage() {
  return (
    <PagePlaceholder
      icon={QrCode}
      title="Your ticket"
      description="A ticket stub with your seats and a QR code. Built in P3."
      phase="P3"
    />
  );
}
