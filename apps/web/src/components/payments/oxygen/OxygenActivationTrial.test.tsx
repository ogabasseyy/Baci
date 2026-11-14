import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OxygenActivationTrial } from './OxygenActivationTrial';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));
const reference = 'b75cd437-28af-4008-a1af-7e6810282833';
beforeEach(() => {
  vi.resetAllMocks();
});
it('automatically activates the paid selected plan without a button', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ status: 'ready', result: {} }))
    .mockResolvedValueOnce(
      Response.json({
        status: 'activated',
        orderConfirmed: true,
        result: { loan_reference: reference, status: 'ACTIVATED' },
      })
    );
  const view = render(<OxygenActivationTrial reference={reference} />);
  await screen.findByText('Payment plan confirmed');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  const posts = fetcher.mock.calls.filter(
    ([, options]) => options?.method === 'POST'
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toEqual({ reference });
  view.rerender(<OxygenActivationTrial reference={reference} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
it('never repeats an indeterminate activation when reopened', async () => {
  fetcher.mockResolvedValue(
    Response.json({ status: 'indeterminate', result: {} })
  );
  render(<OxygenActivationTrial reference={reference} />);
  await screen.findByText(/We’re waiting for Oxygen/);
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'POST')
  ).toBe(false);
});
it('does not activate another booking when the server declines trial access', async () => {
  fetcher.mockResolvedValue(
    Response.json({ error: 'Trial unavailable' }, { status: 404 })
  );
  render(
    <OxygenActivationTrial reference="438f96ee-37c4-49bb-a56c-51451f9cb624" />
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'POST')
  ).toBe(false);
});

it('shows provider rejection without a repeat activation button', async () => {
  fetcher.mockResolvedValue(Response.json({ status: 'rejected', result: {} }));
  render(<OxygenActivationTrial reference={reference} />);
  await screen.findByText(/couldn’t finalise your payment plan/);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'POST')
  ).toBe(false);
});

it('observes an activation already running in the callback without another mutation', async () => {
  vi.useFakeTimers();
  try {
    fetcher
      .mockResolvedValueOnce(Response.json({ status: 'executing', result: {} }))
      .mockResolvedValueOnce(
        Response.json({ status: 'activated', orderConfirmed: true, result: {} })
      );
    render(<OxygenActivationTrial reference={reference} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByText('Payment plan confirmed')).toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === 'POST')
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('advances once only after stored activation matches the selected reference', async () => {
  const confirmed = vi.fn();
  fetcher.mockResolvedValue(
    Response.json({
      status: 'activated',
      orderConfirmed: true,
      result: { loan_reference: reference, status: 'ACTIVATED' },
    })
  );
  const view = render(
    <OxygenActivationTrial reference={reference} onActivated={confirmed} />
  );
  await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
  view.rerender(
    <OxygenActivationTrial reference={reference} onActivated={confirmed} />
  );
  expect(confirmed).toHaveBeenCalledTimes(1);
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'POST')
  ).toBe(false);
});
it.each([
  'rejected',
  'indeterminate',
  'executing',
  'activated',
])('does not navigate from %s without matching activation evidence', async (status) => {
  const confirmed = vi.fn();
  fetcher.mockResolvedValue(
    Response.json({
      status,
      orderConfirmed: true,
      result: { loan_reference: 'another-reference', status: 'ACTIVATED' },
    })
  );
  render(
    <OxygenActivationTrial reference={reference} onActivated={confirmed} />
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(confirmed).not.toHaveBeenCalled();
});

it('automatically activates the current paid booking and advances only on its matching response', async () => {
  const current = '1e65cf4b-4942-4ade-8149-e894687f6c40';
  const confirmed = vi.fn();
  fetcher
    .mockResolvedValueOnce(Response.json({ status: 'ready', result: {} }))
    .mockResolvedValueOnce(
      Response.json({
        status: 'activated',
        orderConfirmed: true,
        result: { loan_reference: current, status: 'ACTIVATED' },
      })
    );
  render(<OxygenActivationTrial reference={current} onActivated={confirmed} />);
  await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0][0]).toContain(`reference=${current}`);
  const posts = fetcher.mock.calls.filter(
    ([, opts]) => opts?.method === 'POST'
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toEqual({ reference: current });
  expect(screen.queryByRole('button')).toBeNull();
});
