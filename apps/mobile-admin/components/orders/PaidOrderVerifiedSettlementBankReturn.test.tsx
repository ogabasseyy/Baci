import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { DARK_COLORS, type ThemeColors } from '@/constants/theme';
import { PaidOrderVerifiedSettlement } from './PaidOrderVerifiedSettlement';

const mocks = vi.hoisted(() => ({
  finance: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const id = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';
const testColors: ThemeColors = DARK_COLORS;

vi.mock('@/lib/paid-order-amendment-api', async (load) => ({
  ...(await load<typeof import('@/lib/paid-order-amendment-api')>()),
  paidOrderAmendment: {
    finance: mocks.finance,
  },
}));
vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  AuthenticatedFetchPreflightError: class extends Error {},
}));
vi.mock('@/lib/api-base-url', () => ({ BASE_URL: 'http://127.0.0.1' }));
vi.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: mocks.get,
    setItem: mocks.set,
    removeItem: mocks.remove,
  },
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/utils/uuid', () => ({ generateUUID: () => id }));
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
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
    onChangeText: (text: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

it('does not carry an outgoing evidence ID into a different bank-return claim', async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  const firstClaimId = id;
  const secondClaimId = '52778a83-0ed7-4fa5-9e1d-4ea7a085b218';
  const baseVerification = {
    canStart: false,
    canRefund: true,
    summary: { amendmentId: id },
    customer: null,
    isVerifiedFunding: true,
    verifiedCancellationPending: true,
    bankEvidence: [],
  };
  const props = {
    orderId: id,
    amendmentId: id,
    operatorId: id,
    colors: testColors,
    refreshOrder: vi.fn().mockResolvedValue(true),
  };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <PaidOrderVerifiedSettlement
        {...props}
        verification={{
          ...baseVerification,
          events: [
            {
              id: 1,
              type: 'offline_disbursement_claimed',
              createdAt: '2026-11-23T12:00:00Z',
              details: { claimId: firstClaimId },
            },
          ],
        }}
      />
    </QueryClientProvider>
  );
  const input = screen.getByRole('textbox', {
    name: 'Verified outgoing bank evidence ID',
  });
  fireEvent.change(input, { target: { value: secondClaimId } });
  expect(input).toHaveValue(secondClaimId);

  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <PaidOrderVerifiedSettlement
        {...props}
        verification={{
          ...baseVerification,
          events: [
            {
              id: 2,
              type: 'offline_disbursement_claimed',
              createdAt: '2026-11-23T13:00:00Z',
              details: { claimId: secondClaimId },
            },
          ],
        }}
      />
    </QueryClientProvider>
  );

  expect(
    screen.getByRole('textbox', {
      name: 'Verified outgoing bank evidence ID',
    })
  ).toHaveValue('');
});
