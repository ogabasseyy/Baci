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

it('offers a workspace reload when stale cached data blocks settlement actions', async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  const refreshOrder = vi.fn().mockResolvedValue(true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaidOrderVerifiedSettlement
        orderId={id}
        amendmentId={id}
        operatorId={id}
        colors={testColors}
        refreshOrder={refreshOrder}
        workspaceFresh={false}
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
    await screen.findByRole('button', { name: 'Reload order status' })
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Put order on hold for cancellation' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  await waitFor(() => expect(refreshOrder).toHaveBeenCalledOnce());
});

it('keeps reload available inside an open cancellation sheet when workspace data goes stale', async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  const refreshOrder = vi.fn().mockResolvedValue(true);
  const verification = {
    canStart: false,
    canRefund: true,
    summary: { amendmentId: id },
    customer: null,
    isVerifiedFunding: true,
    canOpenVerifiedCancellation: true,
    events: [],
    bankEvidence: [],
  };
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <PaidOrderVerifiedSettlement
        orderId={id}
        amendmentId={id}
        operatorId={id}
        colors={testColors}
        refreshOrder={refreshOrder}
        verification={verification}
        workspaceFresh
      />
    </QueryClientProvider>
  );

  const beginCancellation = await screen.findByRole('button', {
    name: 'Put order on hold for cancellation',
  });
  await waitFor(() => expect(beginCancellation).toBeEnabled());
  fireEvent.click(beginCancellation);
  expect(
    await screen.findByText('Hold fulfillment for cancellation')
  ).toBeVisible();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Cancellation reason' }),
    {
      target: { value: 'Customer requested cancellation' },
    }
  );
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  view.rerender(
    <QueryClientProvider client={client}>
      <PaidOrderVerifiedSettlement
        orderId={id}
        amendmentId={id}
        operatorId={id}
        colors={testColors}
        refreshOrder={refreshOrder}
        verification={verification}
        workspaceFresh={false}
      />
    </QueryClientProvider>
  );

  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  await waitFor(() => expect(refreshOrder).toHaveBeenCalledOnce());
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
