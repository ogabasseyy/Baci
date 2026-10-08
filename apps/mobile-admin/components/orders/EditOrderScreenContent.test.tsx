import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { useEditOrderController } from '@/hooks/useEditOrderController';
import { EditOrderScreenContent } from './EditOrderScreenContent';

const routerState = vi.hoisted(() => ({
  back: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: routerState,
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerLeft?: () => ReactNode; headerTitle?: string };
    }) => (
      <div>
        <h1>{String(options?.headerTitle ?? '')}</h1>
        {options?.headerLeft?.()}
      </div>
    ),
  },
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: () =>
      React.createElement('div', { role: 'progressbar' }),
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { disabled?: boolean };
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-disabled': disabled || accessibilityState?.disabled,
          'aria-label': accessibilityLabel,
          disabled: disabled || accessibilityState?.disabled,
          onClick: () => {
            if (!(disabled || accessibilityState?.disabled)) {
              onPress?.();
            }
          },
          type: 'button',
        },
        children
      ),
    ScrollView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/ui/AppFormScreen', () => ({
  AppFormScreen: ({
    children,
    footer,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
  }) => (
    <main>
      {children}
      {footer}
    </main>
  ),
}));

vi.mock('@/components/ui/SuccessModal', () => ({
  SuccessModal: ({
    onActionPress,
    visible,
  }: {
    onActionPress?: () => void;
    visible: boolean;
  }) =>
    visible ? (
      <button
        aria-label="View Order Details"
        onClick={onActionPress}
        type="button"
      >
        View Order Details
      </button>
    ) : null,
}));

vi.mock('./EditOrderFooterBar', () => ({
  EditOrderFooterBar: () => <div>Edit footer</div>,
}));
vi.mock('./NewOrderChannelSection', () => ({
  NewOrderChannelSection: () => <div>Channel</div>,
}));
vi.mock('./NewOrderCustomerSheet', () => ({
  NewOrderCustomerSheet: () => null,
}));
vi.mock('./NewOrderDetailsSection', () => ({
  NewOrderDetailsSection: ({
    showDateField = true,
  }: {
    showDateField?: boolean;
  }) => (
    <div>
      Details{showDateField && <button type="button">Select order date</button>}
    </div>
  ),
}));
vi.mock('./NewOrderEditItemSheet', () => ({
  NewOrderEditItemSheet: () => null,
}));
vi.mock('./NewOrderFinancialSheet', () => ({
  NewOrderFinancialSheet: () => null,
}));
vi.mock('./NewOrderItemsSection', () => ({
  NewOrderItemsSection: () => <div>Items</div>,
}));
vi.mock('./NewOrderNotesSection', () => ({
  NewOrderNotesSection: () => <div>Notes</div>,
}));
vi.mock('./NewOrderProductSheet', () => ({
  NewOrderProductSheet: () => null,
}));
vi.mock('./NewOrderQuickAddDialog', () => ({
  NewOrderQuickAddDialog: () => null,
}));

function createController(
  overrides: Partial<ReturnType<typeof useEditOrderController>> = {}
): ReturnType<typeof useEditOrderController> {
  const colors = {
    background: '#ffffff',
    primary: '#2563eb',
    text: '#0f172a',
    textOnPrimary: '#ffffff',
    textSecondary: '#64748b',
  } as ReturnType<typeof useEditOrderController>['colors'];
  const defaults = {
    colors,
    isEditError: false,
    isEditLoading: false,
    isSubmitting: false,
    order: { id: 'order-1' },
    orderId: 'order-1',
    setShowSuccessModal: vi.fn(),
    showSuccessModal: true,
    viewOrder: vi.fn(),
  } satisfies Partial<ReturnType<typeof useEditOrderController>>;

  return {
    ...defaults,
    ...overrides,
  } as ReturnType<typeof useEditOrderController>;
}

describe('EditOrderScreenContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders edit order content with a working cancel action and footer', () => {
    const controller = createController();

    render(<EditOrderScreenContent controller={controller} />);

    expect(screen.getByText('Edit Order')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select order date' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit order' }));

    expect(controller.viewOrder).toHaveBeenCalledTimes(1);
    expect(routerState.back).not.toHaveBeenCalled();
    expect(screen.getByText('Edit footer')).toBeInTheDocument();
    expect(screen.getByText('Items')).toBeInTheDocument();
  });

  it.each([
    'cancelled',
    'returned',
  ] as const)('hides the date picker for %s orders', (shipping_status) => {
    const controller = createController({
      order: { id: 'order-1', shipping_status },
    });

    render(<EditOrderScreenContent controller={controller} />);

    expect(
      screen.queryByRole('button', { name: 'Select order date' })
    ).not.toBeInTheDocument();
  });

  it('hides the date picker while the order is loading', () => {
    const controller = createController({ order: undefined });

    render(<EditOrderScreenContent controller={controller} />);

    expect(
      screen.queryByRole('button', { name: 'Select order date' })
    ).not.toBeInTheDocument();
  });

  it('disables the cancel action while submitting', () => {
    const controller = createController({ isSubmitting: true });

    render(<EditOrderScreenContent controller={controller} />);

    const cancelButton = screen.getByRole('button', {
      name: 'Cancel edit order',
    });
    expect(cancelButton).toBeDisabled();
    fireEvent.click(cancelButton);
    expect(controller.viewOrder).not.toHaveBeenCalled();
  });

  it('renders a loading state while the order is loading', () => {
    render(
      <EditOrderScreenContent
        controller={createController({ isEditLoading: true })}
      />
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders an error state when the order lookup fails', () => {
    const controller = createController({
      isEditError: true,
      order: undefined,
    });

    render(<EditOrderScreenContent controller={controller} />);

    expect(screen.getByText('Unable to load order')).toBeInTheDocument();
    expect(screen.queryByText('Edit footer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to order' }));
    expect(controller.viewOrder).toHaveBeenCalledTimes(1);
  });

  it('goes back when the order lookup fails without an order id', () => {
    const controller = createController({
      isEditError: true,
      order: undefined,
      orderId: undefined,
    });

    render(<EditOrderScreenContent controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Return to order' }));

    expect(routerState.back).toHaveBeenCalledTimes(1);
    expect(controller.viewOrder).not.toHaveBeenCalled();
  });

  it('returns to order details from the success modal action', () => {
    const controller = createController();

    render(<EditOrderScreenContent controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'View Order Details' }));

    expect(controller.setShowSuccessModal).toHaveBeenCalledWith(false);
    expect(controller.viewOrder).toHaveBeenCalledTimes(1);
  });
});
