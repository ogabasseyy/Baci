import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetch }));

import { useOxygenResidentialContext } from './use-oxygen-residential-context';

beforeEach(() => fetch.mockReset());
it('returns the current workflow address and identifies checkout-derived data', async () => {
  fetch.mockResolvedValue(
    Response.json({ address: { city: 'Ikeja' }, source: 'checkout' })
  );
  const { result } = renderHook(() => useOxygenResidentialContext('first'));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.address).toEqual({ city: 'Ikeja' });
  expect(result.current.fromCheckout).toBe(true);
});
it('ignores a late response after switching workflow and fails safely for invalid data', async () => {
  const pending = Promise.withResolvers<Response>();
  fetch
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(
      Response.json({ address: { city: 'x'.repeat(201) } })
    );
  const view = renderHook(({ id }) => useOxygenResidentialContext(id), {
    initialProps: { id: 'first' },
  });
  view.rerender({ id: 'second' });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  expect(view.result.current.address).toEqual({});
  await act(async () =>
    pending.resolve(Response.json({ address: { city: 'old' } }))
  );
  expect(view.result.current.address).toEqual({});
  expect(view.result.current.fromCheckout).toBe(false);
});
