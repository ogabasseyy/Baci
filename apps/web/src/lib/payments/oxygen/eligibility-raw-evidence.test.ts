import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';
import {
  createOxygenResponseRecorder,
  readOxygenResponseEvidence,
} from './response-evidence';

const key = 'ab'.repeat(32);
const workflow = '60000000-0000-4000-8000-000000000001';
const command = '70000000-0000-4000-8000-000000000001';

it.each([
  200, 400,
])('retains the exact eligibility response for HTTP %s only as encrypted evidence', async (status) => {
  const raw =
    '{ "message": "check email", "link": "https://link.example/?token=private-fixture" }\n';
  let ciphertext = '';
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    if (args.p_operation === 'record') {
      ciphertext = String(args.p_ciphertext);
      return { data: { recorded: true }, error: null };
    }
    return { data: [{ sequence: 1, ciphertext }], error: null };
  });
  const worker = { rpc };
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private-token',
    fetch: async () => new Response(raw, { status }),
    observe: createOxygenResponseRecorder(
      worker,
      workflow,
      command,
      key,
      new Set()
    ),
  });
  if (status === 200) await provider.call('eligibility', {});
  else await expect(provider.call('eligibility', {})).rejects.toThrow();
  expect(ciphertext).not.toContain('private-fixture');
  const evidence = await readOxygenResponseEvidence(
    worker,
    workflow,
    command,
    key
  );
  expect(evidence).toEqual([
    expect.objectContaining({
      operation: 'eligibility',
      httpStatus: status,
      eligibilityRaw: {
        capture: 'complete',
        bodyBase64: Buffer.from(raw).toString('base64'),
      },
    }),
  ]);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('private-fixture');
});

it('does not retain raw bodies from other provider operations', async () => {
  let ciphertext = '';
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_operation === 'record') {
        ciphertext = String(args.p_ciphertext);
        return { data: {}, error: null };
      }
      return { data: [{ sequence: 1, ciphertext }], error: null };
    }),
  };
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private-token',
    fetch: async () => Response.json({ otp: 'private-otp' }),
    observe: createOxygenResponseRecorder(
      worker,
      workflow,
      command,
      key,
      new Set()
    ),
  });
  await provider.call('kyc', {});
  const evidence = await readOxygenResponseEvidence(
    worker,
    workflow,
    command,
    key
  );
  expect(JSON.stringify(evidence)).not.toContain('private-otp');
  expect(evidence[0]).not.toHaveProperty('eligibilityRaw');
});

it('records that an oversized eligibility response was not fully retained', async () => {
  let ciphertext = '';
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_operation === 'record') {
        ciphertext = String(args.p_ciphertext);
        return { data: {}, error: null };
      }
      return { data: [{ sequence: 1, ciphertext }], error: null };
    }),
  };
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private-token',
    fetch: async () => Response.json({ ignored: 'x'.repeat(12001) }),
    observe: createOxygenResponseRecorder(
      worker,
      workflow,
      command,
      key,
      new Set()
    ),
  });
  await provider.call('eligibility', {});
  const evidence = await readOxygenResponseEvidence(
    worker,
    workflow,
    command,
    key
  );
  expect(evidence[0]).toMatchObject({
    eligibilityRaw: { capture: 'oversized' },
  });
});

it('captures a non-JSON eligibility error without logging or parsing its body', async () => {
  let ciphertext = '';
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_operation === 'record') {
        ciphertext = String(args.p_ciphertext);
        return { data: {}, error: null };
      }
      return { data: [{ sequence: 1, ciphertext }], error: null };
    }),
  };
  const body = 'private upstream text\n';
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private-token',
    fetch: async () => new Response(body, { status: 400 }),
    observe: createOxygenResponseRecorder(
      worker,
      workflow,
      command,
      key,
      new Set()
    ),
  });
  await expect(provider.call('eligibility', {})).rejects.toThrow();
  const evidence = await readOxygenResponseEvidence(
    worker,
    workflow,
    command,
    key
  );
  expect(evidence[0]).toMatchObject({
    eligibilityRaw: {
      capture: 'complete',
      bodyBase64: Buffer.from(body).toString('base64'),
    },
  });
  expect(JSON.stringify(worker.rpc.mock.calls)).not.toContain(body);
});
