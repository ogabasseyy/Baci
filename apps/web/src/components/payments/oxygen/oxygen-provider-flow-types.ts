import type { OxygenJourneyStage } from '@/lib/payments/oxygen/journey-events';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';

export type OxygenProviderFlowProps = {
  orderId: string;
  merchantSlug?: string;
  productAmount?: number;
  products?: OxygenCheckoutProduct[];
  currency?: string;
  active?: boolean;
  prefill?: OxygenCustomerPrefill;
  onProgress?: (stage: OxygenJourneyStage) => void;
};
