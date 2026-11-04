import type { ReactNode } from 'react';

export interface OxygenCheckoutSlots {
  verifiedOxygenOrderId?: string;
  oxygenStep?: ReactNode;
  oxygenSummary?: ReactNode;
  oxygenMobileSummary?: ReactNode;
}
