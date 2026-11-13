import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { router } from 'expo-router';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderDetailsScreenContent } from './OrderDetailsScreenContent';
import { createController } from './OrderDetailsScreenContent.test-support';
import { formatOrderDetailsDate } from './order-details.formatters';

const auditTrailCardMock = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
  router: {
    push: vi.fn(),
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode };
    }) => options?.headerRight?.() ?? null,
  },
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

// OrderDetailsScreenContent reads the merchant for VAT-breakdown display.
// Mock it so the real hook's native import graph never loads under vitest.
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { country: 'NG' } }),
}));

vi.mock('react-native', async () =>
  (await import('./OrderDetailsScreenContent.test-support')).reactNativeMock()
);

vi.mock('@/components/orders/OrderItemDetailModal', () => ({
  OrderItemDetailModal: () => null,
}));
vi.mock('@/components/orders/OrderPaymentOptionDialog', () => ({
  OrderPaymentOptionDialog: () => null,
}));
vi.mock('@/components/orders/OrderStatusSheet', () => ({
  OrderStatusSheet: () => null,
}));
vi.mock('@/components/orders/RecordPaymentSheet', () => ({
  RecordPaymentSheet: () => null,
}));
vi.mock('@/components/orders/ShipmentFlowSheet', () => ({
  ShipmentFlowSheet: () => null,
}));
vi.mock('@/hooks/useOrderDetailsGiglExternalWaybill', () => ({
  useOrderDetailsGiglExternalWaybill: () => undefined,
}));
vi.mock('@/components/orders/ShipOnCreditDialog', () => ({
  ShipOnCreditDialog: () => null,
}));
vi.mock('@/components/ui/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: () => null,
}));
vi.mock('@/components/ui/SuccessModal', () => ({
  SuccessModal: () => null,
}));
vi.mock('./OrderDetailsFooterBar', () => ({
  OrderDetailsFooterBar: () => null,
}));
vi.mock('./OrderDetailsItemsAndPaymentSection', () => ({
  OrderDetailsItemsAndPaymentSection: () => null,
}));
vi.mock('./OrderDetailsOverviewSection', () => ({
  OrderDetailsOverviewSection: ({
    createdAtLabel,
    updatedAtLabel,
  }: {
    createdAtLabel: string;
    updatedAtLabel: string;
  }) => (
    <div>
      <span>Placed on {createdAtLabel}</span>
      <span>Latest update: {updatedAtLabel}</span>
    </div>
  ),
}));
vi.mock('./OrderDetailsShippingSection', () => ({
  OrderDetailsShippingSection: () => null,
}));
vi.mock('./OrderAuditTrailCard', () => ({
  OrderAuditTrailCard: (props: unknown) => {
    auditTrailCardMock(props);
    return <div>audit-card</div>;
  },
}));

describe('OrderDetailsScreenContent', () => {
  it('navigates to order edit and renders header share plus audit actions', () => {
    render(<OrderDetailsScreenContent controller={createController()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit order' }));

    expect(router.push).toHaveBeenCalledWith('/order/edit?id=order-1');
    expect(
      screen.getByRole('button', { name: 'Share order' })
    ).toBeInTheDocument();
    expect(screen.getByText('audit-card')).toBeInTheDocument();
  });

  it('passes audit error state to the audit trail card', () => {
    render(
      <OrderDetailsScreenContent
        controller={createController({ isAuditEventsError: true })}
      />
    );

    expect(auditTrailCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true })
    );
  });

  it('hides the edit action for terminal orders', () => {
    const controller = createController();
    if (controller.order) {
      controller.order.shipping_status = 'cancelled';
    }

    render(<OrderDetailsScreenContent controller={controller} />);

    expect(
      screen.queryByRole('button', { name: 'Edit order' })
    ).not.toBeInTheDocument();
  });

  it('hides the order screen content from accessibility while the status drawer is open', () => {
    render(
      <OrderDetailsScreenContent
        controller={createController({ showStatusModal: true })}
      />
    );

    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-accessibility-elements-hidden',
      'true'
    );
    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-important-for-accessibility',
      'no-hide-descendants'
    );
  });

  it('keeps the order screen content accessible by default', () => {
    render(<OrderDetailsScreenContent controller={createController()} />);

    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-accessibility-elements-hidden',
      'false'
    );
    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-important-for-accessibility',
      'auto'
    );
  });
  it('shows the historical sale date in Lagos instead of the recording date', () => {
    const controller = createController({ formatDate: formatOrderDetailsDate });
    if (!controller.order) throw new Error('Missing order fixture');
    controller.order.transaction_date = '2023-03-13T23:00:00.000Z';
    controller.order.created_at = '2026-11-12T10:00:00.000Z';
    controller.order.updated_at = '2026-11-13T10:00:00.000Z';
    const originalOrder = structuredClone(controller.order);

    render(<OrderDetailsScreenContent controller={controller} />);

    expect(
      screen.getByText('Placed on 14 Mar 2023, 00:00')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Latest update: ${formatOrderDetailsDate(controller.order.updated_at)}`
      )
    ).toBeInTheDocument();
    expect(controller.order).toEqual(originalOrder);
    expect(auditTrailCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ formatDate: formatOrderDetailsDate })
    );
  });

  it('falls back to the recording date when the sale date is missing', () => {
    const controller = createController();
    if (!controller.order) throw new Error('Missing order fixture');
    controller.order.transaction_date = null;
    controller.order.created_at = '2026-11-12T23:30:00.000Z';

    render(<OrderDetailsScreenContent controller={controller} />);

    expect(
      screen.getByText('Placed on 13 Nov 2026, 00:30')
    ).toBeInTheDocument();
  });
});
