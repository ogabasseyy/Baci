import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { useOxygenSelfieRenewalBridge } from './use-oxygen-selfie-renewal-bridge';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));
const snapshot = {
  workflowId: 'same-workflow',
  executionEnabled: true,
  stage: 'kyc_required',
  state: { validated: true, selfieUrl: 'https://selfie.example/expired' },
} as OxygenRuntimeSnapshot;
describe('selfie renewal bridge', () => {
  it('checks provider completion then renews only the same workflow', async () => {
    m.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
      )
    );
    const submit = vi.fn().mockResolvedValue(true);
    const open = vi.fn();
    const { result, rerender } = renderHook(
      (p) => useOxygenSelfieRenewalBridge(p, false, submit, open),
      { initialProps: snapshot }
    );
    await act(async () => {
      expect(
        await result.current(
          snapshot.state.selfieUrl ?? '',
          'same-workflow',
          true
        )
      ).toBe('renewed');
    });
    expect(submit).toHaveBeenCalledWith({ action: 'selfie_link' });
    rerender({
      ...snapshot,
      state: { ...snapshot.state, selfieUrl: 'https://selfie.example/fresh' },
    });
    expect(open).toHaveBeenCalledWith(
      'https://selfie.example/fresh',
      'same-workflow'
    );
  });
  it('returns confirmed without refreshing the link when the provider already completed', async () => {
    m.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ confirmed: true, checkedAt: '2026-11-05T16:00:00Z' })
      )
    );
    const submit = vi.fn();
    const open = vi.fn();
    const { result } = renderHook(() =>
      useOxygenSelfieRenewalBridge(snapshot, false, submit, open)
    );
    await expect(
      result.current(snapshot.state.selfieUrl ?? '', 'same-workflow', true)
    ).resolves.toBe('confirmed');
    expect(submit).not.toHaveBeenCalled();
  });
  it('rejects another workflow or pending commands before any provider request', async () => {
    m.fetch.mockClear();
    const { result } = renderHook(() =>
      useOxygenSelfieRenewalBridge(snapshot, true, vi.fn(), vi.fn())
    );
    await expect(
      result.current(snapshot.state.selfieUrl ?? '', 'other', true)
    ).rejects.toThrow();
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

it('permits one automatic renewal and bounds explicit retry attempts', async () => {
  m.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
      )
  );
  const submit = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() =>
    useOxygenSelfieRenewalBridge(snapshot, false, submit, vi.fn())
  );
  const url = snapshot.state.selfieUrl ?? '';
  await result.current(url, 'same-workflow', true);
  await expect(result.current(url, 'same-workflow', true)).rejects.toThrow();
  await result.current(url, 'same-workflow', false);
  await result.current(url, 'same-workflow', false);
  await expect(result.current(url, 'same-workflow', false)).rejects.toThrow();
  expect(submit).toHaveBeenCalledTimes(3);
});
it('never reopens a camera the customer closed while renewal was dispatched', async () => {
  m.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
      )
  );
  const submit = vi.fn().mockResolvedValue(true);
  const open = vi.fn();
  const abort = new AbortController();
  const { result, rerender } = renderHook(
    (p) => useOxygenSelfieRenewalBridge(p, false, submit, open),
    { initialProps: snapshot }
  );
  await result.current(
    snapshot.state.selfieUrl ?? '',
    'same-workflow',
    false,
    abort.signal
  );
  abort.abort();
  rerender({
    ...snapshot,
    state: { ...snapshot.state, selfieUrl: 'https://selfie.example/fresh' },
  });
  expect(open).not.toHaveBeenCalled();
});

it('does not replace a newer session if the old completion read finishes late', async () => {
  let respond: (response: Response) => void = () => undefined;
  m.fetch.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      })
  );
  const submit = vi.fn();
  const { result, rerender } = renderHook(
    (p) => useOxygenSelfieRenewalBridge(p, false, submit, vi.fn()),
    { initialProps: snapshot }
  );
  const request = result.current(
    snapshot.state.selfieUrl ?? '',
    'same-workflow',
    true
  );
  const rejected = expect(request).rejects.toThrow();
  rerender({
    ...snapshot,
    state: { ...snapshot.state, selfieUrl: 'https://selfie.example/newer' },
  });
  respond(
    new Response(
      JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
    )
  );
  await rejected;
  expect(submit).not.toHaveBeenCalled();
});

it('adopts a recovered replacement snapshot after a lost submission response', async () => {
  m.fetch.mockResolvedValue(
    Response.json({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
  );
  const submit = vi.fn().mockResolvedValue(false);
  const open = vi.fn();
  const { result, rerender } = renderHook(
    (p) => useOxygenSelfieRenewalBridge(p, false, submit, open, true),
    { initialProps: snapshot }
  );
  await expect(
    result.current(snapshot.state.selfieUrl ?? '', 'same-workflow', true)
  ).rejects.toThrow();
  rerender({
    ...snapshot,
    state: { ...snapshot.state, selfieUrl: 'https://selfie.example/recovered' },
  });
  expect(open).toHaveBeenCalledWith(
    'https://selfie.example/recovered',
    'same-workflow'
  );
});
it('explicitly recovers an expired canonical replacement without reopening it', async () => {
  m.fetch.mockResolvedValue(
    Response.json({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
  );
  const submit = vi.fn().mockResolvedValue(true);
  const open = vi.fn();
  const expired =
    'https://selfie.example/?securityToken=e30.eyJleHAiOjF9.signature';
  const { result } = renderHook(() =>
    useOxygenSelfieRenewalBridge(
      { ...snapshot, state: { ...snapshot.state, selfieUrl: expired } },
      false,
      submit,
      open,
      true
    )
  );
  await result.current('https://selfie.example/old', 'same-workflow', false);
  expect(submit).toHaveBeenCalledWith({ action: 'selfie_link' });
  expect(open).not.toHaveBeenCalled();
});
it('allows authoritative completion reads during reconciliation but never renews', async () => {
  const submit = vi.fn();
  const { result } = renderHook(() =>
    useOxygenSelfieRenewalBridge(
      { ...snapshot, stage: 'reconciliation_required' },
      false,
      submit,
      vi.fn()
    )
  );
  m.fetch.mockResolvedValue(
    Response.json({ confirmed: true, checkedAt: '2026-11-05T16:00:00Z' })
  );
  await expect(
    result.current(snapshot.state.selfieUrl ?? '', 'same-workflow', true)
  ).resolves.toBe('confirmed');
  m.fetch.mockResolvedValue(
    Response.json({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
  );
  await expect(
    result.current(snapshot.state.selfieUrl ?? '', 'same-workflow', false)
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
it('bounds a stalled submission without permitting an overlapping renewal', async () => {
  vi.useFakeTimers();
  try {
    m.fetch.mockResolvedValue(
      Response.json({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
    );
    const submit = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useOxygenSelfieRenewalBridge(snapshot, false, submit, vi.fn())
    );
    const request = result.current(
      snapshot.state.selfieUrl ?? '',
      'same-workflow',
      true
    );
    const rejected = expect(request).rejects.toThrow('outcome unknown');
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    await rejected;
    await expect(
      result.current(snapshot.state.selfieUrl ?? '', 'same-workflow', false)
    ).rejects.toThrow();
    expect(submit).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
