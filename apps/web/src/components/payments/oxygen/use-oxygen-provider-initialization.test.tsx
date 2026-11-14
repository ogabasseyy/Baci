import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { useOxygenProvider } from './use-oxygen-provider';

const order = '60000000-0000-4000-8000-000000000001';
const workflow = '60000000-0000-4000-8000-000000000002';
const snapshot = {
  workflowId: workflow,
  stage: 'application_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {},
};
beforeEach(() => vi.resetAllMocks());

it('explicitly resumes the same order after a lost create response without a provider action', async () => {
  api.fetch
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot));
  const { result } = renderHook(() => useOxygenProvider(order));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await act(() => result.current.refresh());
  expect(result.current.snapshot?.workflowId).toBe(workflow);
  expect(result.current.error).toBe('');
  expect(api.fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/payments/oxygen/workflows',
    '/api/payments/oxygen/workflows',
    `/api/payments/oxygen/workflows/actions?workflowId=${workflow}`,
  ]);
  expect(JSON.parse(api.fetch.mock.calls[1][1].body)).toEqual({
    orderId: order,
    channel: 'web',
  });
});

it('retries only the saved-state read after creation returned an ID', async () => {
  api.fetch
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValueOnce(Response.json(snapshot));
  const { result } = renderHook(() => useOxygenProvider(order));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await act(() => result.current.refresh());
  expect(result.current.snapshot?.workflowId).toBe(workflow);
  expect(
    api.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  ).toHaveLength(1);
  expect(api.fetch.mock.calls[2][0]).toBe(
    `/api/payments/oxygen/workflows/actions?workflowId=${workflow}`
  );
});

it('ignores a late failure from the previous order after switching orders', async () => {
  let rejectOld!: (reason: Error) => void;
  const oldRequest = new Promise<Response>((_resolve, reject) => {
    rejectOld = reject;
  });
  api.fetch
    .mockReturnValueOnce(oldRequest)
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot));
  const { result, rerender } = renderHook(
    ({ orderId }) => useOxygenProvider(orderId),
    {
      initialProps: { orderId: order },
    }
  );
  rerender({ orderId: '60000000-0000-4000-8000-000000000003' });
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(workflow)
  );
  await act(async () => {
    rejectOld(new Error('old request failed'));
    await Promise.resolve();
  });
  expect(result.current.error).toBe('');
  expect(result.current.snapshot?.workflowId).toBe(workflow);
});

it('clears the sign-in state after an authorized explicit retry', async () => {
  api.fetch
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot));
  const { result } = renderHook(() => useOxygenProvider(order));
  await waitFor(() => expect(result.current.needsSignIn).toBe(true));
  await act(() => result.current.refresh());
  expect(result.current.needsSignIn).toBe(false);
  expect(result.current.snapshot?.workflowId).toBe(workflow);
});

it('ignores an old saved-read failure after switching orders', async () => {
  let rejectOld!: (reason: Error) => void;
  const oldRead = new Promise<Response>((_resolve, reject) => {
    rejectOld = reject;
  });
  api.fetch
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockReturnValueOnce(oldRead)
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot));
  const { result, rerender } = renderHook(
    ({ orderId }) => useOxygenProvider(orderId),
    {
      initialProps: { orderId: order },
    }
  );
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(workflow)
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refresh();
  });
  rerender({ orderId: '60000000-0000-4000-8000-000000000003' });
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(workflow)
  );
  await act(async () => {
    rejectOld(new Error('old read failed'));
    await pending;
  });
  expect(result.current.error).toBe('');
  expect(result.current.needsSignIn).toBe(false);
});

it.each([
  'success',
  'failure',
] as const)('ignores an old action %s after switching orders', async (outcome) => {
  let resolveAction!: (value: Response) => void;
  let rejectAction!: (reason: Error) => void;
  const action = new Promise<Response>((resolve, reject) => {
    resolveAction = resolve;
    rejectAction = reject;
  });
  const nextWorkflow = '60000000-0000-4000-8000-000000000004';
  api.fetch
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockReturnValueOnce(action)
    .mockResolvedValueOnce(Response.json({ workflow: { id: nextWorkflow } }))
    .mockResolvedValueOnce(
      Response.json({ ...snapshot, workflowId: nextWorkflow })
    );
  const { result, rerender } = renderHook(
    ({ orderId }) => useOxygenProvider(orderId),
    { initialProps: { orderId: order } }
  );
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(workflow)
  );
  const onConfirmed = vi.fn();
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.submit(
      { action: 'refresh_kyc' },
      undefined,
      onConfirmed
    );
  });
  rerender({ orderId: '60000000-0000-4000-8000-000000000003' });
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(nextWorkflow)
  );
  await act(async () => {
    if (outcome === 'failure') rejectAction(new Error('lost response'));
    else resolveAction(Response.json({ ...snapshot, version: 2 }));
    expect(await pending).toBe(false);
  });
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(result.current.snapshot?.workflowId).toBe(nextWorkflow);
  expect(result.current.error).toBe('');
  expect(api.fetch).toHaveBeenCalledTimes(5);
});

it('does not unlock a new order action when the old action finishes', async () => {
  let finishOld!: (value: Response) => void;
  let finishNew!: (value: Response) => void;
  const oldAction = new Promise<Response>((resolve) => {
    finishOld = resolve;
  });
  const newAction = new Promise<Response>((resolve) => {
    finishNew = resolve;
  });
  const newWorkflow = '60000000-0000-4000-8000-000000000004';
  api.fetch
    .mockResolvedValueOnce(Response.json({ workflow: { id: workflow } }))
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockReturnValueOnce(oldAction)
    .mockResolvedValueOnce(Response.json({ workflow: { id: newWorkflow } }))
    .mockResolvedValueOnce(
      Response.json({ ...snapshot, workflowId: newWorkflow })
    )
    .mockReturnValueOnce(newAction);
  const { result, rerender } = renderHook(
    ({ orderId }) => useOxygenProvider(orderId),
    { initialProps: { orderId: order } }
  );
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(workflow)
  );
  let oldPending!: Promise<boolean>;
  act(() => {
    oldPending = result.current.submit({ action: 'refresh_kyc' });
  });
  rerender({ orderId: '60000000-0000-4000-8000-000000000003' });
  await waitFor(() =>
    expect(result.current.snapshot?.workflowId).toBe(newWorkflow)
  );
  let newPending!: Promise<boolean>;
  act(() => {
    newPending = result.current.submit({ action: 'refresh_kyc' });
  });
  await act(async () => {
    finishOld(Response.json({ ...snapshot, version: 2 }));
    await oldPending;
  });
  expect(await result.current.submit({ action: 'refresh_kyc' })).toBe(false);
  expect(api.fetch).toHaveBeenCalledTimes(6);
  await act(async () => {
    finishNew(
      Response.json({ ...snapshot, workflowId: newWorkflow, version: 2 })
    );
    await newPending;
  });
});
