import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { DARK_COLORS, type ThemeColors } from '@/constants/theme';
import { PaidOrderAmendmentError } from '@/lib/paid-order-amendment-api';
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

it.each([
  false,
  true,
])('preserves a missing settlement only if an earlier request is pending (%s)', async (replay) => {
  vi.clearAllMocks();
  const payload = {
    action: 'record_verified_lender_refund',
    idempotencyKey: id,
  };
  mocks.get.mockResolvedValue(replay ? JSON.stringify(payload) : null);
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.finance.mockRejectedValueOnce(
    new PaidOrderAmendmentError('Order not found', 404)
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
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
          verifiedCreditDirectRefund: true,
        }}
      />
    </QueryClientProvider>
  );
  const action = await screen.findByRole('button', {
    name: replay
      ? 'Retry the same settlement request'
      : 'Record verified Credit Direct refund',
  });
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
  expect(await screen.findByText(/Order not found/)).toBeVisible();
  expect(mocks.remove).toHaveBeenCalledTimes(replay ? 0 : 1);
  expect(
    screen.queryByRole('button', {
      name: 'Retry the same settlement request',
    }) !== null
  ).toBe(replay);
});

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

it('clears unreadable saved settlement data and requires an order refresh', async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue('{"action":"unsupported"}');
  mocks.remove.mockResolvedValue(undefined);
  let resolveRefresh: (refreshed: boolean) => void = () => undefined;
  const refreshOrder = vi
    .fn<() => Promise<boolean>>()
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve))
    )
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
          canOpenVerifiedCancellation: true,
          events: [],
          bankEvidence: [],
        }}
      />
    </QueryClientProvider>
  );

  expect(
    await screen.findByText(/saved settlement request could not be read/i)
  ).toBeVisible();
  expect(mocks.remove).toHaveBeenCalledOnce();
  const cancel = screen.getByRole('button', {
    name: 'Put order on hold for cancellation',
  });
  expect(cancel).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  expect(refreshOrder).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('button', { name: 'Reload order status' })
  ).toBeDisabled();
  resolveRefresh(false);
  expect(
    await screen.findByText('Unable to refresh order status. Try again.')
  ).toBeVisible();
  expect(cancel).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  await waitFor(() => expect(cancel).toBeEnabled());
});

it('restores the unreadable settlement lock from storage after remount', async () => {
  vi.clearAllMocks();
  const operationKey = ['verified-amendment-operation', id, id, id].join(':');
  const recovery = new Map<string, string>([
    [operationKey, '{"action":"unsupported"}'],
  ]);
  mocks.get.mockImplementation(
    async (key: string) => recovery.get(key) ?? null
  );
  mocks.set.mockImplementation(async (key: string, value: string) => {
    recovery.set(key, value);
  });
  mocks.remove.mockImplementation(async (key: string) => {
    recovery.delete(key);
  });
  const firstQueryClient = new QueryClient();
  const props = {
    orderId: id,
    amendmentId: id,
    operatorId: id,
    colors: testColors,
    refreshOrder: vi.fn().mockResolvedValue(true),
    verification: {
      canStart: false,
      canRefund: true,
      summary: { amendmentId: id },
      customer: null,
      isVerifiedFunding: true,
      canOpenVerifiedCancellation: true,
      events: [],
      bankEvidence: [],
    },
  };
  const first = render(
    <QueryClientProvider client={firstQueryClient}>
      <PaidOrderVerifiedSettlement {...props} />
    </QueryClientProvider>
  );
  expect(
    await screen.findByText(/saved settlement request could not be read/i)
  ).toBeVisible();
  first.unmount();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaidOrderVerifiedSettlement {...props} />
    </QueryClientProvider>
  );
  expect(
    await screen.findByRole('button', { name: 'Reload order status' })
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Put order on hold for cancellation' })
  ).toBeDisabled();
  expect(mocks.get).toHaveBeenCalledWith(`${operationKey}:unreadable`);
});

it('does not show unreadable recovery while stored settlement data is loading', () => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(new Promise(() => undefined));
  render(
    <QueryClientProvider client={new QueryClient()}>
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
          isVerifiedFunding: true,
          canOpenVerifiedCancellation: true,
          events: [],
          bankEvidence: [],
        }}
      />
    </QueryClientProvider>
  );
  expect(
    screen.queryByRole('button', { name: 'Reload order status' })
  ).not.toBeInTheDocument();
});

it('lets staff retry a failed saved-settlement storage read', async () => {
  vi.clearAllMocks();
  mocks.get.mockRejectedValueOnce(new Error('Storage unavailable'));
  mocks.get.mockResolvedValue(null);
  render(
    <QueryClientProvider client={new QueryClient()}>
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
          isVerifiedFunding: true,
          canOpenVerifiedCancellation: true,
          events: [],
          bankEvidence: [],
        }}
      />
    </QueryClientProvider>
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry saved settlement check' })
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry saved settlement check' })
    ).not.toBeInTheDocument()
  );
  expect(
    screen.getByRole('button', { name: 'Put order on hold for cancellation' })
  ).toBeEnabled();
});
