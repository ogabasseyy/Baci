import { expect, it } from 'vitest';
import { formatOrderStatus } from './format-order-status';

it('distinguishes Oxygen-managed funding from actual payment and missing status', () => {
  expect(formatOrderStatus('pending', 'oxygen')).toBe('Managed by Oxygen');
  expect(formatOrderStatus('unpaid', 'oxygen')).toBe('Managed by Oxygen');
  expect(formatOrderStatus('paid', 'oxygen')).toBe('Paid');
  expect(formatOrderStatus('pending', 'card')).toBe('Pending');
  expect(formatOrderStatus(undefined, 'oxygen')).toBe('Unavailable');
  expect(formatOrderStatus('partially_refunded', 'oxygen')).toBe(
    'Partially Refunded'
  );
});
