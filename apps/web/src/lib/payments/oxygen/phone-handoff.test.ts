import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock('./runtime-service', () => ({
  readOxygenSnapshot: m.read,
  oxygenRuntimeRpc: m.rpc,
}));

import { issueOxygenPhoneHandoff } from './phone-handoff';

const id = '60000000-0000-4000-8000-000000000001';
const jwt = (seconds: number) =>
  `head.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + seconds })).toString('base64url')}.sig`;
const url = (seconds: number) =>
  `https://staging.d1l1k5yxed9cvn.amplifyapp.com/?securityToken=${jwt(seconds)}`;
const saved = {
  workflowId: id,
  stage: 'reconciliation_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  state: { applicationReference: id, validated: true, selfieUrl: url(200) },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
const user = { rpc: vi.fn() };
const worker = vi.fn();
const call = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(saved);
  m.rpc.mockResolvedValue(saved);
  worker.mockResolvedValue(user);
  fetchMock
    .mockResolvedValueOnce(new Response('{"ready":true}'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          qr: 'data:image/png;base64,synthetic',
          expiresAt: Date.now() + 200000,
        })
      )
    );
});
it('reuses a valid saved link and touches neither NIN nor commands', async () => {
  const result = await issueOxygenPhoneHandoff(
    user,
    worker,
    { call },
    'partner',
    id,
    fetchMock
  );
  expect(result.qr).toMatch(/^data:image/);
  expect(call).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith(user, 'worker_status', id);
});
it('renews only the same application selfie URL when it has expired', async () => {
  m.rpc.mockResolvedValue({
    ...saved,
    state: { ...saved.state, selfieUrl: url(-100) },
  });
  call.mockResolvedValue({ url: url(300) });
  await issueOxygenPhoneHandoff(
    user,
    worker,
    { call },
    'partner',
    id,
    fetchMock
  );
  expect(call).toHaveBeenCalledExactlyOnceWith('selfie', {
    loan_request_reference: id,
    partner_reference: 'partner',
  });
});
it('checks ownership before any bridge or provider access', async () => {
  m.read.mockRejectedValue(new Error('not owned'));
  await expect(
    issueOxygenPhoneHandoff(user, worker, { call }, 'partner', id, fetchMock)
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});
it('does not request a new link while the restricted tunnel is unavailable', async () => {
  fetchMock.mockReset().mockResolvedValue(new Response('{"ready":false}'));
  await expect(
    issueOxygenPhoneHandoff(user, worker, { call }, 'partner', id, fetchMock)
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('rejects a mismatched application before requesting or exposing a link', async () => {
  m.rpc.mockResolvedValue({
    ...saved,
    state: {
      ...saved.state,
      applicationReference: '60000000-0000-4000-8000-000000000002',
    },
  });
  await expect(
    issueOxygenPhoneHandoff(user, worker, { call }, 'partner', id, fetchMock)
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
});
