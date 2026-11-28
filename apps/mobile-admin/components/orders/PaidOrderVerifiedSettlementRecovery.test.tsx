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
