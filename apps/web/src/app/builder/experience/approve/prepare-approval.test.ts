import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost: post }));

import { prepareApprovalUntilReady } from './prepare-approval';

const initialId = '11111111-1111-4111-8111-111111111111';
const renewedId = '22222222-2222-4222-8222-222222222222';

function setup() {
  const controller = new AbortController();
  const onProgress = vi.fn();
  const prepare = () =>
    prepareApprovalUntilReady({
      approvalId: initialId,
      action: 'prepare-draft',
      signal: controller.signal,
      onProgress,
    });
  return { controller, onProgress, prepare };
}

afterEach(() => {
  vi.useRealTimers();
  post.mockReset();
});

it('backs off on the same intent, follows the renewed ID, and stops at ready', async () => {
  vi.useFakeTimers();
  const { prepare, onProgress, controller } = setup();
  const ready = {
    approvalId: renewedId,
    status: 'ready',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  post
    .mockResolvedValueOnce({ approvalId: initialId, status: 'preparing' })
    .mockResolvedValueOnce({ approvalId: renewedId, status: 'preparing' })
    .mockResolvedValueOnce(ready);

  const result = prepare();
  await vi.advanceTimersByTimeAsync(3_999);
  expect(post).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(post).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(result).resolves.toEqual(ready);
  expect(post).toHaveBeenLastCalledWith(
    '/api/builder-experience/approval',
    { action: 'prepare-draft', approvalId: renewedId },
    { signal: controller.signal }
  );
  expect(onProgress.mock.calls).toEqual([
    [initialId],
    [renewedId],
    [renewedId],
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels the retry delay on disconnect and preserves the abort reason', async () => {
  vi.useFakeTimers();
  const { controller, prepare } = setup();
  post.mockResolvedValue({ approvalId: initialId, status: 'preparing' });
  const error = Error('left approval page');
  const result = expect(prepare()).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(error);
  await result;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(post).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('leaves a reconciled receipt as a terminal result', async () => {
  const receipt = { approvalId: renewedId, status: 'reconciled' };
  post.mockResolvedValue(receipt);
  await expect(setup().prepare()).resolves.toEqual(receipt);
  expect(post).toHaveBeenCalledTimes(1);
});

it('rejects malformed and failed responses without polling again', async () => {
  post.mockResolvedValueOnce({ approvalId: 'invalid-id', status: 'ready' });
  await expect(setup().prepare()).rejects.toThrow();
  post.mockRejectedValueOnce(Error('approval unavailable'));
  await expect(setup().prepare()).rejects.toThrow('approval unavailable');
  expect(post).toHaveBeenCalledTimes(2);
});

it('stops polling after the preparation deadline', async () => {
  vi.useFakeTimers();
  post.mockResolvedValue({ approvalId: initialId, status: 'preparing' });
  const result = expect(setup().prepare()).rejects.toThrow(
    'Approval preparation did not complete.'
  );
  await vi.advanceTimersByTimeAsync(30 * 60_000 + 20_000);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
