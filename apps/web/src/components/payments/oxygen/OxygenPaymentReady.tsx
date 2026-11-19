'use client';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenPaymentCompletion } from './OxygenPaymentCompletion';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';
import { useOxygenPaymentRecovery } from './use-oxygen-payment-recovery';

type Props = {
  workflowId: string;
  version: number;
  executionEnabled: boolean;
  reference: string;
  plan?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
  active: boolean;
  busy: boolean;
  readSaved?: () => Promise<void>;
};

function EnabledPaymentReady(props: Props) {
  const recovery = useOxygenPaymentRecovery(
    props.workflowId,
    props.reference,
    props.version,
    props.readSaved
  );
  return (
    <OxygenPaymentCompletion
      {...props}
      busy={props.busy || recovery.busy}
      checkStatus={recovery.checkStatus}
      error={recovery.error}
    />
  );
}

export function OxygenPaymentReady(props: Props) {
  return props.executionEnabled ? (
    <EnabledPaymentReady {...props} />
  ) : (
    <OxygenPaymentCompletion {...props} />
  );
}
