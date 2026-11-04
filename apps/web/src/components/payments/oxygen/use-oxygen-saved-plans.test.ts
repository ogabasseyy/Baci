import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { useOxygenSavedPlans } from './use-oxygen-saved-plans';

const empty = { plans: [], selectedReference: null };
it('serializes rapid preference writes while changing the local selection instantly', async () => {
  let finish: ((value: Response) => void) | undefined;
  m.fetch.mockReset();
  m.fetch.mockResolvedValueOnce(Response.json(empty));
  m.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  m.fetch.mockResolvedValue(Response.json(empty));
  const view = renderHook(() => useOxygenSavedPlans('workflow'));
  await waitFor(() => expect(view.result.current.data).toEqual(empty));
  act(() => {
    void view.result.current.select('first');
    void view.result.current.select('second');
    void view.result.current.select('first');
  });
  expect(view.result.current.selected).toBe('first');
  expect(m.fetch).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish?.(Response.json(empty));
  });
  await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(3));
  expect(
    m.fetch.mock.calls
      .slice(1)
      .map(([, o]) => JSON.parse(String(o.body)).bookingReference)
  ).toEqual(['first', 'first']);
});
it('preserves the selected preview and allows retry after a failed save', async () => {
  m.fetch.mockReset();
  m.fetch.mockResolvedValueOnce(Response.json(empty));
  m.fetch.mockResolvedValueOnce(
    Response.json({ error: 'Unavailable' }, { status: 503 })
  );
  m.fetch.mockResolvedValue(Response.json(empty));
  const view = renderHook(() => useOxygenSavedPlans('workflow'));
  await waitFor(() => expect(view.result.current.data).toEqual(empty));
  await act(async () => {
    await view.result.current.select('reference');
  });
  expect(view.result.current.selected).toBe('reference');
  expect(view.result.current.error).toContain('could not be saved');
  await act(async () => {
    await view.result.current.select('reference');
  });
  expect(view.result.current.error).toBe('');
});
it('fails closed on a cache load error and supports a read-only reload', async () => {
  m.fetch.mockReset();
  m.fetch.mockResolvedValueOnce(
    Response.json({ error: 'Unavailable' }, { status: 404 })
  );
  m.fetch.mockResolvedValue(Response.json(empty));
  const view = renderHook(() => useOxygenSavedPlans('workflow'));
  await waitFor(() =>
    expect(view.result.current.error).toContain('unavailable')
  );
  act(() => view.result.current.reload());
  await waitFor(() => expect(view.result.current.data).toEqual(empty));
  expect(m.fetch.mock.calls.every(([, o]) => !o.method)).toBe(true);
});
it('admits only one quote while pending and does not automatically retry a failed booking', async () => {
  m.fetch.mockReset();
  m.fetch.mockResolvedValueOnce(Response.json(empty));
  let finish: ((response: Response) => void) | undefined;
  m.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const view = renderHook(() => useOxygenSavedPlans('workflow'));
  await waitFor(() => expect(view.result.current.data).toEqual(empty));
  act(() => {
    void view.result.current.quote(35, 6);
    void view.result.current.quote(35, 12);
  });
  expect(m.fetch).toHaveBeenCalledTimes(2);
  expect(view.result.current.quoting).toBe(true);
  await act(async () =>
    finish?.(Response.json({ error: 'Unavailable' }, { status: 409 }))
  );
  expect(view.result.current.quoting).toBe(false);
  expect(view.result.current.error).toContain('uncertain bookings');
  expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('finishes older preference writes before requesting a new quote', async () => {
  m.fetch.mockReset();
  m.fetch.mockResolvedValueOnce(Response.json(empty));
  let finish: ((response: Response) => void) | undefined;
  m.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  m.fetch.mockResolvedValue(Response.json(empty));
  const view = renderHook(() => useOxygenSavedPlans('workflow'));
  await waitFor(() => expect(view.result.current.data).toEqual(empty));
  act(() => {
    void view.result.current.select('old-reference');
    void view.result.current.quote(35, 6);
  });
  expect(m.fetch).toHaveBeenCalledTimes(2);
  await act(async () => finish?.(Response.json(empty)));
  await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(3));
  expect(m.fetch.mock.calls[2][0]).toMatch(/\/quote$/);
});
