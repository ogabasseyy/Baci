import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderChangeItems } from './PaidOrderChangeItems';
import { PaidOrderVerifiedSettlement } from './PaidOrderVerifiedSettlement';

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  search: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  checkConfirmation: vi.fn(),
  finance: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const id = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';
const bankEvidenceId = 'f58ed34e-0761-4ffe-83f4-a4cb4bdcce14';

vi.mock('@/hooks/orders/usePaidOrderAmendment', () => ({
  usePaidOrderAmendment: mocks.workspace,
}));
vi.mock('@/lib/paid-order-amendment-api', async (load) => ({
  ...(await load<typeof import('@/lib/paid-order-amendment-api')>()),
  paidOrderAmendment: {
    search: mocks.search,
    preview: mocks.preview,
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

function showButton() {
  render(
    <PaidOrderChangeItems
      colors={{} as ThemeColors}
      orderId={id}
      merchantId={id}
      items={[{ id, quantity: 1, name: 'Tecno Pop 10', price: 129867.5 }]}
      formatPrice={(amount) => `₦${amount.toFixed(2)}`}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockReturnValue({
    canStart: true,
    canRefund: true,
    confirm: mocks.confirm,
    checkConfirmation: mocks.checkConfirmation,
  });
});

it('hides the entry when the server has paused new changes', () => {
  mocks.workspace.mockReturnValue({ canStart: false });
  showButton();
  expect(screen.queryByRole('button', { name: 'Change items' })).toBeNull();
});

it.each([
  ['bank_transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['pos', 'POS'],
])('submits the selected verified %s entry with the preview and consent', async (method, label) => {
  mocks.search.mockResolvedValue([
    { id, kind: 'variant', label: 'Tecno Pop 20 · 3 GB / 64 GB' },
  ]);
  mocks.preview.mockResolvedValue({
    previewId: id,
    beforeLine: { name: 'Tecno Pop 10', quantity: 1 },
    afterLine: {
      name: 'Tecno Pop 20',
      variantName: '3 GB / 64 GB',
      quantity: 1,
    },
    beforeTotalMinor: 12986750,
    afterTotalMinor: 14986750,
    adjustmentMinor: 2000000,
    bankEvidence: [{ id: bankEvidenceId, amountMinor: 2000000, method }],
  });
  mocks.confirm.mockResolvedValue('confirmed');
  showButton();
  fireEvent.click(screen.getByRole('button', { name: 'Change items' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Find a replacement' }),
    { target: { value: 'Tecno' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search catalog' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Tecno Pop 20 · 3 GB / 64 GB' })
  );
  expect(await screen.findByText('Extra payment ₦20000.00')).toBeVisible();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Reason for the change' }),
    { target: { value: 'Customer upgrade' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Customer agreed' }));
  const confirmation = screen.getByRole('button', { name: 'Confirm change' });
  expect(confirmation).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', {
      name: `${label} · ₦20000.00 · ${bankEvidenceId.slice(0, 8)}`,
    })
  );
  expect(confirmation).toBeEnabled();
  fireEvent.click(confirmation);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.confirm).toHaveBeenCalledWith({
    previewId: id,
    bankEvidenceId,
    reason: 'Customer upgrade',
    customerAgreed: true,
    idempotencyKey: id,
  });
});

it('offers status recovery while new changes are paused', async () => {
  const pending = {
    previewId: id,
    idempotencyKey: id,
    reason: 'Synthetic upgrade',
    customerAgreed: true,
  };
  mocks.workspace.mockReturnValue({
    canStart: false,
    pending,
    confirm: mocks.confirm,
    checkConfirmation: mocks.checkConfirmation,
  });
  mocks.checkConfirmation.mockResolvedValue('unknown');
  showButton();
  fireEvent.click(screen.getByRole('button', { name: 'Check item change' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Check confirmation status' })
  );
  expect(
    await screen.findByText(/Confirmation is still unverified/)
  ).toBeVisible();
  expect(mocks.checkConfirmation).toHaveBeenCalledWith(pending);
  expect(
    screen.queryByRole('textbox', { name: 'Find a replacement' })
  ).toBeNull();
});

it('retries the exact verified cancellation command after an ambiguous response', async () => {
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
        colors={{} as ThemeColors}
        refreshOrder={vi.fn()}
        verification={{
          canStart: false,
          canRefund: true,
          summary: { amendmentId: id },
          customer: null,
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

it.each([
  'Cash',
  'POS',
])('records %s against the accepted preview', async (method) => {
  mocks.search.mockResolvedValue([
    { id, kind: 'variant', label: 'Tecno Pop 20' },
  ]);
  mocks.preview.mockResolvedValue({
    previewId: id,
    beforeLine: { name: 'Tecno Pop 10', quantity: 1 },
    afterLine: { name: 'Tecno Pop 20', quantity: 1 },
    beforeTotalMinor: 12986750,
    afterTotalMinor: 14986750,
    adjustmentMinor: 2000000,
    bankEvidence: [],
    canRecordStaffTopUp: true,
  });
  mocks.confirm.mockResolvedValue('confirmed');
  showButton();
  fireEvent.click(screen.getByRole('button', { name: 'Change items' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Find a replacement' }),
    {
      target: { value: 'Tecno' },
    }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search catalog' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Tecno Pop 20' }));
  fireEvent.click(await screen.findByRole('button', { name: method }));
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Reason for the change' }),
    {
      target: { value: 'Customer upgrade' },
    }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Customer agreed' }));
  const confirm = screen.getByRole('button', {
    name: 'Record payment and confirm change',
  });
  if (method === 'POS') {
    expect(confirm).toBeDisabled();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'POS receipt reference' }),
      {
        target: { value: ' POS-123456 ' },
      }
    );
  }
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(mocks.confirm).toHaveBeenCalledWith({
    previewId: id,
    idempotencyKey: id,
    reason: 'Customer upgrade',
    customerAgreed: true,
    staffTopUp:
      method === 'Cash'
        ? { method: 'cash' }
        : { method: 'pos', receiptReference: 'POS-123456' },
  });
});
