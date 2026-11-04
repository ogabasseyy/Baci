import { act, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';

const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'NOT_DONE',
  address_status: 'NOT_DONE',
} as const;
const base: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 2,
  environment: 'staging',
  executionEnabled: true,
  state: { validated: true, kyc },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
const expired = `https://verify.example/selfie?securityToken=x.${btoa(JSON.stringify({ exp: 1 }))}.x`;

it('renews a generated link when it expires, but does not repeat the same renewal', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const renderFlow = (snapshot: OxygenRuntimeSnapshot) => (
    <OxygenGuidedVerification
      snapshot={snapshot}
      busy={false}
      error=""
      submit={submit}
    />
  );
  const view = render(renderFlow(base));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  view.rerender(
    renderFlow({
      ...base,
      version: 3,
      state: { ...base.state, selfieUrl: expired },
    })
  );
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls).toEqual([
    [{ action: 'selfie_link' }],
    [{ action: 'selfie_link' }],
  ]);
  view.rerender(
    renderFlow({
      ...base,
      version: 4,
      state: { ...base.state, selfieUrl: expired },
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).toHaveBeenCalledTimes(2);
});

it.each([
  'queued',
  'executing',
  'indeterminate',
] as const)('never renews while a %s command is pending', async (status) => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        state: { ...base.state, selfieUrl: expired },
        pending: {
          action: 'selfie_link',
          status,
          idempotencyKey: '60000000-0000-4000-8000-000000000002',
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).not.toHaveBeenCalled();
});

it('renews an expired link even if no other state update causes a render', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    const expires = Math.floor(Date.now() / 1000) + 10;
    const url = `https://verify.example/selfie?securityToken=x.${btoa(JSON.stringify({ exp: expires }))}.x`;
    const submit = vi.fn().mockResolvedValue(true);
    render(
      <OxygenGuidedVerification
        snapshot={{ ...base, state: { ...base.state, selfieUrl: url } }}
        busy={false}
        error=""
        submit={submit}
      />
    );
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ action: 'selfie_link' });
  } finally {
    vi.useRealTimers();
  }
});

it('does not renew an idle link that expires while an uncertain request is pending', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    const expires = Math.floor(Date.now() / 1000) + 10;
    const url = `https://verify.example/selfie?securityToken=x.${btoa(JSON.stringify({ exp: expires }))}.x`;
    const submit = vi.fn();
    render(
      <OxygenGuidedVerification
        snapshot={{
          ...base,
          state: { ...base.state, selfieUrl: url },
          pending: {
            action: 'selfie_link',
            status: 'indeterminate',
            idempotencyKey: '60000000-0000-4000-8000-000000000002',
          },
        }}
        busy={false}
        error=""
        submit={submit}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(submit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('does not repeatedly request distinct already-expired links', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const view = render(
    <OxygenGuidedVerification
      snapshot={{ ...base, state: { ...base.state, selfieUrl: expired } }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  view.rerender(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        version: 3,
        state: { ...base.state, selfieUrl: `${expired}&replacement=2` },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).toHaveBeenCalledTimes(1);
});

it('allows a later renewal after a usable replacement link is observed', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    const now = Math.floor(Date.now() / 1000);
    const link = (exp: number) =>
      `https://verify.example/selfie?securityToken=x.${btoa(JSON.stringify({ exp }))}.x`;
    const submit = vi.fn().mockResolvedValue(true);
    const flow = (url: string) => (
      <OxygenGuidedVerification
        snapshot={{ ...base, state: { ...base.state, selfieUrl: url } }}
        busy={false}
        error=""
        submit={submit}
      />
    );
    const view = render(flow(link(now + 10)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    view.rerender(flow(link(now + 20)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(submit).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
