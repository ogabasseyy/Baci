import { expect, it, vi } from 'vitest';
import { navigateToOxygenOrder } from './navigate-to-oxygen-order';

it('navigates to the owned Oxygen order as a document request', () => {
  const assign = vi.fn();
  navigateToOxygenOrder('60000000-0000-4000-8000-000000000001', assign);
  expect(assign).toHaveBeenCalledExactlyOnceWith(
    '/payments/oxygen/60000000-0000-4000-8000-000000000001'
  );
});
