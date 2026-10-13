import type Colors from '@/constants/Colors';
import type { SavingsCardContributionSnapshot } from '@/lib/savings-card-contribution-snapshot';

type SavedMethod = { id: string; brand: string; last4: string };
type OperationStatus =
  | 'pending'
  | 'completed'
  | 'collection_failed'
  | 'reconciliation_required';

export type SavingsPlanCardContributionViewProps = {
  amount: string;
  amountLabel: string;
  amountKobo: number | null;
  allowRetry: boolean;
  busy: boolean;
  canStart: boolean;
  canStartNew: boolean;
  capabilityLoaded: boolean;
  colors: (typeof Colors)['light'];
  enabled: boolean;
  expanded: boolean;
  invalidAmount: boolean;
  loading: boolean;
  message: string;
  methods: SavedMethod[];
  onAmountChange: (amount: string) => void;
  onCancelReview: () => void;
  onCheckStatus: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onReview: () => void;
  onNewContribution: () => void;
  onSelectMethod: (id: string) => void;
  onToggle: () => void;
  operationStatus: OperationStatus | null;
  reviewing: boolean;
  selectedMethod: SavedMethod | undefined;
  selectedMethodId: string;
  snapshot: SavingsCardContributionSnapshot | null;
  sourceMode: 'manual' | 'auto_debit';
};
