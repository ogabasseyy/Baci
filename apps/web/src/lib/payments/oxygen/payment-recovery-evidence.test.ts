import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenPaymentRecoveryRecorder } from './payment-recovery-evidence';
import { decryptOxygenResponse } from './response-evidence';

const workflow = '60000000-0000-4000-8000-000000000001';
const command = '70000000-0000-4000-8000-000000000001';
const key = 'ab'.repeat(32);
it('encrypts the returned recovery URL before storage and binds it to its command', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { recorded: true }, error: null });
  const record = createOxygenPaymentRecoveryRecorder(
    { rpc },
    workflow,
    command,
    key,
    new Set(['payment.hydrogenpay.com'])
  );
  await record({
    operation: 'upfront_link',
    httpStatus: 200,
    requestId: null,
    capture: 'parsed',
    durationMs: 10,
    body: {
      url: 'https://payment.hydrogenpay.com/?transactionId=private-link',
      otp: '123456',
    },
  });
  const payload = rpc.mock.calls[0][1].p_payload;
  expect(payload.ciphertext).not.toContain('private-link');
  expect(payload.sequence).toBe(1);
  const recovered = decryptOxygenResponse(
    payload.ciphertext,
    key,
    workflow,
    command,
    1
  );
  expect(recovered).toMatchObject({
    links: {
      url: 'https://payment.hydrogenpay.com/?transactionId=private-link',
    },
  });
  expect(JSON.stringify(recovered)).not.toContain('123456');
  expect(() =>
    decryptOxygenResponse(payload.ciphertext, key, command, workflow, 1)
  ).toThrow();
});
it('fails closed on evidence persistence failure', async () => {
  const record = createOxygenPaymentRecoveryRecorder(
    { rpc: async () => ({ data: null, error: { code: 'unavailable' } }) },
    workflow,
    command,
    key,
    new Set()
  );
  await expect(
    record({
      operation: 'upfront_link',
      httpStatus: 200,
      requestId: null,
      capture: 'parsed',
      durationMs: 1,
      body: {},
    })
  ).rejects.toThrow('Recovery evidence unavailable');
});
