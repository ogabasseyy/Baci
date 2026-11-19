import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetch }));

import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';

it('does not invoke the legacy activation trial for an old trial reference', () => {
  render(
    <OxygenPaymentSuccess reference="b75cd437-28af-4008-a1af-7e6810282833" />
  );
  expect(screen.getByText('Awaiting order confirmation')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});
