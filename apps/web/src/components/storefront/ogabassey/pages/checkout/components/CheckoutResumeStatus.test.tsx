import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckoutResumeGate,
  CheckoutResumeStatus,
} from './CheckoutResumeStatus';

describe('CheckoutResumeStatus', () => {
  it.each([
    ['loading', 'Loading order...'],
    ['initializing', 'Initializing secure checkout...'],
  ] as const)('shows the %s status', (status, message) => {
    render(<CheckoutResumeStatus status={status} />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('renders recovery actions and forwards retry, home, and support clicks', () => {
    const onRetry = vi.fn();
    const onGoHome = vi.fn();
    const onContactSupport = vi.fn();

    render(
      <CheckoutResumeStatus
        status="error"
        message="This order could not be loaded."
        onRetry={onRetry}
        onGoHome={onGoHome}
        onContactSupport={onContactSupport}
      />
    );

    expect(
      screen.getByText('This order could not be loaded.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Homepage' }));
    fireEvent.click(screen.getByRole('button', { name: 'contact support' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onContactSupport).toHaveBeenCalledOnce();
  });
});

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    sharedCartEnabled: true,
    importWarnings: ['import_capacity_exceeded'],
  }),
}));
vi.mock('@/components/storefront/cart/cart-import-conflicts', () => ({
  CartImportConflicts: () => <p>Trim saved items or retry importing</p>,
}));
it.each([
  true,
  false,
])('shows capacity recovery before an unvalidated order resume (%s)', (loading) => {
  render(
    <CheckoutResumeGate
      cartEmpty
      isAutoTriggerProcessing={false}
      isLoadingResumedOrder={loading}
      resumeOrderId="invalid"
      resumeOrderError={loading ? null : 'Not authorized'}
      onContactSupport={vi.fn()}
      onGoHome={vi.fn()}
      onRetry={vi.fn()}
      capacityRecovery={{ validatedResume: false, onReturnToCart: vi.fn() }}
    />
  );
  expect(screen.getByText('Trim saved items or retry importing')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Edit cart items' })).toBeVisible();
  expect(screen.queryByText('Not authorized')).toBeNull();
  expect(screen.queryByText('Loading order...')).toBeNull();
});
it('allows the validated resumed order to initialize without capacity interference', () => {
  render(
    <CheckoutResumeGate
      cartEmpty
      isAutoTriggerProcessing
      isLoadingResumedOrder={false}
      resumeOrderId="validated"
      resumeOrderError={null}
      onContactSupport={vi.fn()}
      onGoHome={vi.fn()}
      onRetry={vi.fn()}
      capacityRecovery={{ validatedResume: true, onReturnToCart: vi.fn() }}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Initializing secure checkout'
  );
  expect(screen.queryByText('Trim saved items or retry importing')).toBeNull();
});
