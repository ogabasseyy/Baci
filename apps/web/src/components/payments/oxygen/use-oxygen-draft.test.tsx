import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenDraft } from './use-oxygen-draft';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));
const workflow = '108497c7-a91c-4f72-b3cf-410ed6800fb3';
const draft = {
  step: 0 as const,
  fields: { first_name: 'Ada', bvn: '12345678901' },
};
const result = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('hydrates the server draft before enabling the form', async () => {
  api.fetch.mockResolvedValue(result({ draft, version: 4 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  expect(hook.result.current.ready).toBe(false);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.initial).toEqual(draft);
});

it('does not enable a blank form when loading failed', async () => {
  api.fetch.mockResolvedValueOnce(result({}, 503));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.status).toBe('error'));
  expect(hook.result.current.ready).toBe(false);
  api.fetch.mockResolvedValueOnce(result({ draft, version: 2 }));
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(hook.result.current.initial).toEqual(draft);
});

it('debounces changes and reports saved only after acknowledgement', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  vi.useFakeTimers();
  api.fetch.mockResolvedValue(result({ version: 1 }));
  act(() => hook.result.current.queue(draft));
  expect(hook.result.current.status).toBe('saving');
  expect(api.fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(api.fetch).toHaveBeenCalledTimes(2);
  expect(hook.result.current.status).toBe('saved');
  expect(hook.result.current.initial).toEqual(draft);
});

it('retries lost responses with the same key before saving newer edits', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  api.fetch.mockRejectedValueOnce(new Error('Network'));
  act(() => hook.result.current.queue(draft));
  await act(async () => {
    await hook.result.current.flush();
  });
  const first = JSON.parse(api.fetch.mock.calls[1][1].body);
  act(() =>
    hook.result.current.queue({ ...draft, fields: { first_name: 'Adanna' } })
  );
  api.fetch
    .mockResolvedValueOnce(result({ version: 1 }))
    .mockResolvedValueOnce(result({ version: 2 }));
  await act(async () => {
    await hook.result.current.retry();
  });
  const retry = JSON.parse(api.fetch.mock.calls[2][1].body);
  const newer = JSON.parse(api.fetch.mock.calls[3][1].body);
  expect(retry).toEqual(first);
  expect(newer.version).toBe(1);
  expect(newer.draft.fields.first_name).toBe('Adanna');
  expect(hook.result.current.status).toBe('saved');
});

it('blocks overwriting a draft changed in another channel', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  api.fetch.mockResolvedValueOnce(result({}, 409));
  act(() => hook.result.current.queue(draft));
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(hook.result.current.status).toBe('conflict');
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(api.fetch).toHaveBeenCalledTimes(2);
});

it('serializes edits made while a save is in flight', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let acknowledge: (value: ReturnType<typeof result>) => void = () => {};
  api.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  act(() => hook.result.current.queue(draft));
  let saving: Promise<boolean>;
  act(() => {
    saving = hook.result.current.flush();
  });
  act(() =>
    hook.result.current.queue({ ...draft, fields: { first_name: 'Latest' } })
  );
  expect(api.fetch).toHaveBeenCalledTimes(2);
  api.fetch.mockResolvedValueOnce(result({ version: 2 }));
  await act(async () => {
    acknowledge(result({ version: 1 }));
    await saving;
  });
  const secondSave = JSON.parse(api.fetch.mock.calls[2][1].body);
  expect(secondSave.version).toBe(1);
  expect(secondSave.draft.fields.first_name).toBe('Latest');
  expect(hook.result.current.status).toBe('saved');
});

it('flushes pending fields with keepalive on pagehide', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  api.fetch.mockResolvedValueOnce(result({ version: 1 }));
  act(() => hook.result.current.queue(draft));
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(api.fetch.mock.calls[1][1].keepalive).toBe(true);
  expect(hook.result.current.status).toBe('saved');
});

it('flushes on hidden visibility without calling a provider endpoint', async () => {
  api.fetch.mockResolvedValueOnce(result({ draft: null, version: 0 }));
  const hook = renderHook(() => useOxygenDraft(workflow));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  api.fetch.mockResolvedValueOnce(result({ version: 1 }));
  act(() => hook.result.current.queue(draft));
  const visible = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(api.fetch.mock.calls[1][0]).toBe('/api/payments/oxygen/draft');
  expect(hook.result.current.status).toBe('saved');
  visible.mockRestore();
});

it('ignores a late duplicate GET after a newer load and edit', async () => {
  let oldResponse: (value: ReturnType<typeof result>) => void = () => {};
  api.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldResponse = resolve;
      })
  );
  const hook = renderHook(() => useOxygenDraft(workflow));
  api.fetch.mockResolvedValueOnce(result({ draft, version: 2 }));
  await act(async () => {
    await hook.result.current.retry();
  });
  api.fetch.mockResolvedValueOnce(result({ version: 3 }));
  act(() =>
    hook.result.current.queue({ ...draft, fields: { first_name: 'Latest' } })
  );
  await act(async () => {
    await hook.result.current.flush();
  });
  await act(async () => {
    oldResponse(
      result({ draft: { ...draft, fields: { first_name: 'Old' } }, version: 0 })
    );
  });
  expect(hook.result.current.initial).toEqual({
    ...draft,
    fields: { first_name: 'Latest' },
  });
  act(() => hook.result.current.queue(draft));
  api.fetch.mockResolvedValueOnce(result({ version: 4 }));
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(JSON.parse(api.fetch.mock.calls.at(-1)?.[1].body).version).toBe(3);
});
