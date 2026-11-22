import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@/lib/merchant-inbox-api', () => ({
  updateInboxConversation: mocks.update,
}));

import { useInboxManage } from './useInboxManage';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const render = () =>
  renderHook(() => useInboxManage({ conversationId: 9, merchantId: 'm1' }), {
    wrapper,
  });

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.update.mockResolvedValue({ id: 9 });
});

describe('useInboxManage', () => {
  it('sends the change for this chat and refreshes the lists and thread', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = render();

    await act(() => result.current.update({ status: 'resolved' }));

    expect(mocks.update).toHaveBeenCalledWith(9, { status: 'resolved' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['inbox-conversations', 'm1'],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['inbox-thread', 'm1', 9],
    });
  });

  it('rejects when the change cannot be saved, and still refreshes', async () => {
    mocks.update.mockRejectedValue(new Error('down'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = render();

    await expect(
      act(() => result.current.update({ priority: 'high' }))
    ).rejects.toThrow('down');

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(invalidate).toHaveBeenCalled();
  });

  it('bugfix: runs overlapping changes one after another', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    mocks.update.mockImplementation(
      (_id: number, change: { addTags?: string[] }) => {
        order.push(`start:${change.addTags?.[0]}`);
        if (change.addTags?.[0] === 'first') {
          return new Promise((resolve) => {
            release = () => {
              order.push('end:first');
              resolve({ id: 9 });
            };
          });
        }
        order.push(`end:${change.addTags?.[0]}`);
        return Promise.resolve({ id: 9 });
      }
    );
    const { result } = render();

    let both: Promise<unknown[]> = Promise.resolve([]);
    act(() => {
      both = Promise.all([
        result.current.update({ addTags: ['first'] }),
        result.current.update({ addTags: ['second'] }),
      ]);
    });
    await waitFor(() => expect(order).toEqual(['start:first']));

    await act(async () => {
      release();
      await both;
    });

    expect(order).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ]);
  });

  it('lets the next change run after one fails', async () => {
    mocks.update
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ id: 9 });
    const { result } = render();

    await expect(
      act(() => result.current.update({ addTags: ['a'] }))
    ).rejects.toThrow('down');
    await act(() => result.current.update({ addTags: ['b'] }));

    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
