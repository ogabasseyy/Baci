import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { DARK_COLORS } from '@/constants/theme';
import type {
  AmendmentWorkspace,
  VerifiedSettlementAction,
} from '@/lib/paid-order-amendment-api';
import { PaidOrderVerifiedBankReturn } from './PaidOrderVerifiedBankReturn';

const id = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';

vi.mock('@/utils/uuid', () => ({ generateUUID: () => id }));
vi.mock('react-native', () => ({
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress} type="button">
      {children}
    </button>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));

function Harness({
  verification,
  onSubmit,
}: {
  verification: AmendmentWorkspace;
  onSubmit: (payload: VerifiedSettlementAction) => void;
}) {
  const [outgoingEvidence, setOutgoingEvidence] = useState<{
    claimId: string | null;
    value: string;
  }>({ claimId: null, value: '' });
  return (
    <PaidOrderVerifiedBankReturn
      verification={verification}
      colors={DARK_COLORS}
      disabled={false}
      outgoingEvidence={outgoingEvidence}
      setOutgoingEvidence={setOutgoingEvidence}
      onSubmit={onSubmit}
    />
  );
}

const verifiedCancellation = {
  canStart: false,
  canRefund: true,
  summary: { amendmentId: id },
  customer: null,
  isVerifiedFunding: true,
  verifiedCancellationPending: true,
  events: [],
  bankEvidence: [],
} satisfies AmendmentWorkspace;

it('claims an eligible verified bank return for repayment', () => {
  const onSubmit = vi.fn();
  render(
    <Harness
      verification={{
        ...verifiedCancellation,
        bankEvidence: [
          {
            id,
            amountMinor: 120_000,
            status: 'unapplied',
            transactionId: null,
            occurredAt: '2026-11-22T13:55:00Z',
            method: 'bank_transfer',
          },
        ],
      }}
      onSubmit={onSubmit}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: /Prepare bank repayment/ })
  );
  expect(onSubmit).toHaveBeenCalledWith({
    action: 'claim_offline_disbursement',
    sourceKind: 'unapplied',
    sourceId: id,
    idempotencyKey: id,
  });
});

it('records outgoing evidence against the outstanding bank-return claim', () => {
  const onSubmit = vi.fn();
  render(
    <Harness
      verification={{
        ...verifiedCancellation,
        events: [
          {
            type: 'offline_disbursement_claimed',
            details: { claimId: id },
          },
        ],
      }}
      onSubmit={onSubmit}
    />
  );

  fireEvent.change(
    screen.getByRole('textbox', { name: 'Verified outgoing bank evidence ID' }),
    { target: { value: id } }
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify bank repayment' })
  );
  expect(onSubmit).toHaveBeenCalledWith({
    action: 'record_offline_refund',
    claimId: id,
    evidenceId: id,
    idempotencyKey: id,
  });
});
