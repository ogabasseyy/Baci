import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OrderSuccessStatusIcon } from './order-success-status-icon';

it.each([
  [true, false, 'bg-green-100', 'text-green-600'],
  [false, true, 'bg-amber-100', 'text-amber-600'],
  [false, false, 'bg-gray-100', 'animate-spin'],
] as const)('renders the matching visual state for validated=%s and recovery=%s', (hasValidatedOrder, hasRecoveryState, background, iconClass) => {
  const { container } = render(
    <OrderSuccessStatusIcon
      hasValidatedOrder={hasValidatedOrder}
      hasRecoveryState={hasRecoveryState}
    />
  );
  expect(container.firstElementChild).toHaveClass(background);
  expect(container.querySelector('svg')).toHaveClass(iconClass);
});
