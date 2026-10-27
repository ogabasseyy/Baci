import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutCartScreen } from './CheckoutCartScreen';

const gate = vi.hoisted(() => ({
  props: null as unknown as Record<string, unknown>,
}));
vi.mock('./CheckoutCartCapacityGate', () => ({
  CheckoutCartCapacityGate: (props: Record<string, unknown>) => {
    gate.props = props;
    return <>{props.children as never}</>;
  },
}));
vi.mock('./CheckoutScreen', () => ({
  CheckoutScreen: () => <p>Checkout form</p>,
}));

const model = { page: { onReturnToCart: vi.fn() } } as never;

it('derives validatedResume from the loaded order matching the request', () => {
  render(
    <CheckoutCartScreen
      model={model}
      order={{ id: 'order-1' } as never}
      requestedId="order-1"
    />
  );
  expect(gate.props.validatedResume).toBe(true);
  expect(screen.getByText('Checkout form')).toBeVisible();
});

it('does not validate a resume from the raw query id alone', () => {
  render(
    <CheckoutCartScreen model={model} order={null} requestedId="order-1" />
  );
  expect(gate.props.validatedResume).toBe(false);
});
