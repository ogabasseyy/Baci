import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { PaidOrderChangeItemsSheet } from './PaidOrderChangeItemsSheet';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/hooks/orders/authenticated-fetch', () => ({}));
vi.mock('@/lib/api-base-url', () => ({ BASE_URL: 'https://test.invalid' }));
vi.mock('@/utils/uuid', () => ({ generateUUID: () => 'fixture-key' }));
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
  }: {
    children: ReactNode;
    onPress: () => void;
  }) => (
    <button onClick={onPress} type="button">
      {children}
    </button>
  ),
}));

it('retries a pending confirmation without starting a fresh preview', async () => {
  const pending = {
    previewId: 'preview',
    idempotencyKey: 'key',
    customerAgreed: true as const,
    reason: 'Customer upgrade',
  };
  const confirm = vi.fn().mockResolvedValue('confirmed');
  const onClose = vi.fn();
  render(
    <PaidOrderChangeItemsSheet
      orderId="order"
      items={[]}
      formatPrice={String}
      amendment={{
        canStart: false,
        canRefund: false,
        summary: null,
        verification: null,
        operatorId: 'operator',
        refreshOrder: vi.fn(),
        pending,
        confirm,
        checkConfirmation: vi.fn(),
      }}
      onClose={onClose}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry the same confirmation' })
  );
  expect(confirm).toHaveBeenCalledExactlyOnceWith(pending);
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
