import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type React from 'react';
import { ThemedBadge } from '@/components/themed/themed-badge';

const BADGE_LAYOUT =
  'text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 w-fit';

export const ReceiptStatusBadge: React.FC<{ status: string }> = ({
  status,
}) => {
  switch (status) {
    case 'Paid':
      return (
        <ThemedBadge colorRole="primary" className={BADGE_LAYOUT}>
          <CheckCircle2 size={12} /> Paid
        </ThemedBadge>
      );
    case 'Partially Paid':
      return (
        <ThemedBadge colorRole="secondary" className={BADGE_LAYOUT}>
          <Clock size={12} /> Partial
        </ThemedBadge>
      );
    default:
      return (
        <ThemedBadge variant="destructive" className={BADGE_LAYOUT}>
          <AlertCircle size={12} /> Unpaid
        </ThemedBadge>
      );
  }
};
