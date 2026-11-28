import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('retries the exact verified cancellation command after an ambiguous response', async () => {
  vi.clearAllMocks();
  const client = new QueryClient();
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.finance
    .mockRejectedValueOnce(new Error('connection interrupted'))
    .mockResolvedValueOnce({ amendmentId: id });
  render(
    <QueryClientProvider client={client}>
      <PaidOrderVerifiedSettlement
        orderId={id}
        amendmentId={id}
        operatorId={id}
        colors={testColors}
        refreshOrder={vi.fn().mockResolvedValue(true)}
        verification={{
          canStart: false,
          canRefund: true,
          summary: { amendmentId: id },
          customer: null,
          events: [],
          bankEvidence: [],
          isVerifiedFunding: true,
          verifiedCancellationReady: true,
          verifiedCancellationPending: true,
        }}
      />
    </QueryClientProvider>
  );
  const cancel = screen.getByRole('button', {
    name: 'Cancel with verified refunds',
  });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Cancellation reason' }),
    { target: { value: 'Customer request' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText(/Unable to verify the outcome/)).toBeVisible();
  const payload = {
    action: 'cancel_with_verified_refunds',
    idempotencyKey: id,
    reason: 'Customer request',
  };
  expect(mocks.finance).toHaveBeenNthCalledWith(1, id, id, payload);
  expect(mocks.set).toHaveBeenCalledWith(
    expect.any(String),
    JSON.stringify(payload)
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry the same settlement request' })
  );
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  expect(mocks.finance).toHaveBeenNthCalledWith(2, id, id, payload);
});

it('keeps settlement actions blocked until a failed post-submit refresh recovers', async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.finance.mockResolvedValue({ amendmentId: id });
  const refreshOrder = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaidOrderVerifiedSettlement
        orderId={id}
        amendmentId={id}
        operatorId={id}
        colors={testColors}
        refreshOrder={refreshOrder}
        verification={{
          canStart: false,
          canRefund: true,
          summary: { amendmentId: id },
          customer: null,
          isVerifiedFunding: true,
          verifiedCreditDirectRefund: true,
          events: [],
          bankEvidence: [],
        }}
      />
    </QueryClientProvider>
  );
  const refund = screen.getByRole('button', {
    name: 'Record verified Credit Direct refund',
  });
  await waitFor(() => expect(refund).toBeEnabled());
  fireEvent.click(refund);
  expect(
    await screen.findByRole('button', { name: 'Reload order status' })
  ).toBeVisible();
  expect(refund).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  await waitFor(() => expect(refund).toBeEnabled());
  expect(refreshOrder).toHaveBeenCalledTimes(2);
});
