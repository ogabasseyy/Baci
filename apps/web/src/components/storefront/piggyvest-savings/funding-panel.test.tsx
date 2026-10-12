import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FundingPanel } from './funding-panel';

function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const ready = (number: string) => ({
  status: 'ready',
  accounts: [
    {
      accountNumber: number,
      accountName: 'Synthetic account',
      bankName: 'Synthetic bank',
    },
  ],
});

describe('FundingPanel customer isolation', () => {
  it('discards a late response belonging to a previously selected goal', async () => {
    const first = deferred();
    const second = deferred();
    const load = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { rerender } = render(
      <FundingPanel requestKey="session-a:goal-a" load={load} />
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender(<FundingPanel requestKey="session-b:goal-b" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(ready('0000000002')));
    expect(screen.getByText('0000000002')).toBeVisible();
    await act(async () => first.resolve(ready('0000000001')));
    expect(screen.queryByText('0000000001')).not.toBeInTheDocument();
    expect(screen.getByText('0000000002')).toBeVisible();
  });
  it('removes previous account details immediately on goal change or logout', async () => {
    const pending = deferred();
    const load = vi
      .fn()
      .mockResolvedValueOnce(ready('0000000001'))
      .mockReturnValueOnce(pending.promise);
    const { rerender } = render(
      <FundingPanel requestKey="goal-a" load={load} />
    );
    expect(await screen.findByText('0000000001')).toBeVisible();
    rerender(<FundingPanel requestKey="goal-b" load={load} />);
    expect(screen.queryByText('0000000001')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    rerender(<FundingPanel requestKey={null} load={load} />);
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    await act(async () => pending.resolve(ready('0000000002')));
    expect(screen.queryByText('0000000002')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    { ...ready('123'), privateToken: 'synthetic-private' },
    { status: 'ready', accounts: [] },
  ])('fails closed for malformed or expanded responses', async (response) => {
    render(<FundingPanel requestKey="goal" load={async () => response} />);
    expect(
      await screen.findByText('Test funding details are unavailable.')
    ).toBeVisible();
    expect(screen.queryByText('123')).not.toBeInTheDocument();
  });
  it('redacts rejected request errors', async () => {
    render(
      <FundingPanel
        requestKey="goal"
        load={async () => {
          throw new Error('synthetic-private');
        }}
      />
    );
    expect(
      await screen.findByText('Test funding details are unavailable.')
    ).toBeVisible();
    expect(screen.queryByText('synthetic-private')).not.toBeInTheDocument();
  });
});
