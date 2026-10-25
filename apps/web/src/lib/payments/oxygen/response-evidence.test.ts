import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenBookingSchema } from '@/schemas/oxygen-runtime';
import { createOxygenProvider } from './provider';
import {
  createOxygenResponseRecorder,
  decryptOxygenResponse,
  encryptOxygenResponse,
  projectOxygenResponse,
  readOxygenResponseEvidence,
} from './response-evidence';

const key = 'ab'.repeat(32);
const workflow = '60000000-0000-4000-8000-000000000001';
const command = '70000000-0000-4000-8000-000000000001';
const hosts = new Set(['hosted.example.test']);
const response = {
  operation: 'approve' as const,
  httpStatus: 200,
  requestId: null,
  capture: 'parsed' as const,
  durationMs: 10,
  body: {
    status: 'APPROVED',
    loan_reference: workflow,
    total_charges: 'unexpected',
    repayment_setup_link:
      'https://hosted.example.test/setup?token=synthetic-private-link',
    otp: '654321',
    signature: 'synthetic-signature',
    activity_token: 'synthetic-token',
    bvn: 'synthetic-bvn',
    customer: { email: 'private@example.test' },
  },
};
it('preserves allowed response evidence before business validation without copying sensitive input/body fields', () => {
  const safe = projectOxygenResponse(response, hosts);
  expect(safe.terms.status).toBe('APPROVED');
  expect(safe.shape.total_charges).toBe('string');
  expect(safe.terms.total_charges).toBeUndefined();
  expect(safe.links.repayment_setup_link).toContain('synthetic-private-link');
  for (const secret of [
    '654321',
    'synthetic-signature',
    'synthetic-token',
    'synthetic-bvn',
    'private@example.test',
  ])
    expect(JSON.stringify(safe)).not.toContain(secret);
});
it('encrypts links and binds evidence to workflow, command and sequence', () => {
  const safe = projectOxygenResponse(response, hosts);
  const encrypted = encryptOxygenResponse(safe, key, workflow, command, 1);
  expect(encrypted).not.toContain('synthetic-private-link');
  expect(decryptOxygenResponse(encrypted, key, workflow, command, 1)).toEqual(
    safe
  );
  expect(() =>
    decryptOxygenResponse(encrypted, key, command, workflow, 1)
  ).toThrow();
  expect(() =>
    decryptOxygenResponse(encrypted, key, workflow, command, 2)
  ).toThrow();
  expect(encryptOxygenResponse(safe, key, workflow, command, 1)).not.toBe(
    encrypted
  );
});
it('drops untrusted links, retains nested response shape, and bounds repeated link data', () => {
  const safe = projectOxygenResponse(
    {
      ...response,
      body: {
        data: {
          ...response.body,
          repayment_setup_link: 'https://untrusted.example/setup?token=private',
        },
      },
    },
    hosts
  );
  expect(safe.links).toEqual({});
  expect(safe.shape['data.repayment_setup_link']).toBe('string');
  expect(safe.rejectedLinks['data.repayment_setup_link']).toMatchObject({
    reason: 'host',
    host: 'untrusted.example',
  });
  expect(JSON.stringify(safe)).not.toContain('token=private');
});
it('durably captures a successful HTTP response before returning it for validation and provides worker-only recovery inspection', async () => {
  let ciphertext = '';
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    if (args.p_operation === 'record') {
      ciphertext = String(args.p_ciphertext);
      return { data: { recorded: true }, error: null };
    }
    return { data: [{ sequence: 1, ciphertext }], error: null };
  });
  const provider = createOxygenProvider({
    token: async () => 'token',
    fetch: vi.fn().mockResolvedValue(Response.json(response.body)),
    observe: createOxygenResponseRecorder(
      { rpc },
      workflow,
      command,
      key,
      hosts
    ),
  });
  const raw = await provider.call('approve', new FormData());
  expect(raw).toEqual(response.body);
  expect(rpc).toHaveBeenCalledTimes(1);
  // The actual approval schema rejects this reply after evidence is saved.
  expect(() => oxygenBookingSchema.parse(raw)).toThrow();
  const recovered = await readOxygenResponseEvidence(
    { rpc },
    workflow,
    command,
    key
  );
  expect(recovered).toEqual([
    expect.objectContaining({
      terms: { status: 'APPROVED', loan_reference: workflow },
      links: { repayment_setup_link: response.body.repayment_setup_link },
    }),
  ]);
});
it('does not return a successful mutation if evidence persistence fails and never automatically repeats it', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(response.body));
  const provider = createOxygenProvider({
    token: async () => 'token',
    fetch: fetcher,
    observe: createOxygenResponseRecorder(
      { rpc: async () => ({ data: null, error: { code: 'unavailable' } }) },
      workflow,
      command,
      key,
      hosts
    ),
  });
  await expect(provider.call('approve', new FormData())).rejects.toMatchObject({
    outcome: 'indeterminate',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('captures non-JSON replies as metadata without retaining body text', async () => {
  const observe = vi.fn();
  const provider = createOxygenProvider({
    token: async () => 'token',
    fetch: vi
      .fn()
      .mockResolvedValue(
        new Response('private upstream text', { status: 200 })
      ),
    observe,
  });
  await expect(provider.call('approve', new FormData())).rejects.toThrow();
  expect(observe).toHaveBeenCalledWith(
    expect.objectContaining({ capture: 'non_json', httpStatus: 200 })
  );
  expect(JSON.stringify(observe.mock.calls)).not.toContain(
    'private upstream text'
  );
});

it('captures the HTTP status when the response stream is lost', async () => {
  const observe = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private stream error'));
    },
  });
  const provider = createOxygenProvider({
    token: async () => 'token',
    fetch: vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    observe,
  });
  await expect(provider.call('approve', new FormData())).rejects.toMatchObject({
    outcome: 'indeterminate',
  });
  expect(observe).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ capture: 'unavailable', httpStatus: 200 })
  );
  expect(JSON.stringify(observe.mock.calls)).not.toContain(
    'private stream error'
  );
});
it('bounds oversized responses and never retains their text', async () => {
  const observe = vi.fn();
  const provider = createOxygenProvider({
    token: async () => 'token',
    fetch: vi
      .fn()
      .mockResolvedValue(new Response('x'.repeat(2097153), { status: 200 })),
    observe,
  });
  await expect(provider.call('approve', new FormData())).rejects.toThrow();
  expect(observe).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ capture: 'oversized', httpStatus: 200 })
  );
  expect(observe.mock.calls[0][0].body).toBeUndefined();
});
it('captures documented recovery url responses and retains safe rejection metadata', () => {
  const safe = projectOxygenResponse(
    {
      ...response,
      operation: 'upfront_link',
      body: { url: 'https://payment.hydrogenpay.com/?transactionId=private' },
    },
    new Set(['payment.hydrogenpay.com'])
  );
  expect(safe.links.url).toContain('transactionId=private');
  const rejected = projectOxygenResponse(
    {
      ...response,
      operation: 'upfront_link',
      body: { url: 'https://unknown.example/?token=private' },
    },
    new Set()
  );
  expect(rejected.rejectedLinks.url).toMatchObject({
    reason: 'host',
    host: 'unknown.example',
  });
  expect(JSON.stringify(rejected)).not.toContain('token=private');
});

it('records NIN provider error details and KYC states without retaining identity values', async () => {
  const recorded: unknown[] = [];
  const provider = createOxygenProvider({
    token: async () => 'private-token',
    redactionSecrets: ['private-secret'],
    fetch: async () =>
      Response.json(
        {
          message: 'Internal Server Error',
          errors: [
            {
              message: 'NIN upstream unavailable for 12345678901',
              token: 'private-token',
            },
          ],
          details: { password: 'private-secret' },
        },
        { status: 500 }
      ),
    observe: async (r) => {
      recorded.push(projectOxygenResponse(r, hosts));
    },
  });
  await expect(
    provider.call('nin', { partner_reference: 'private-secret' })
  ).rejects.toThrow();
  expect(recorded[0]).toMatchObject({
    operation: 'nin',
    httpStatus: 500,
    failure: {
      providerMessage: 'Internal Server Error',
      details: ['NIN upstream unavailable for [redacted]'],
    },
  });
  expect(JSON.stringify(recorded)).not.toMatch(
    /12345678901|private-token|private-secret|password/
  );
  const kyc = projectOxygenResponse(
    {
      ...response,
      operation: 'kyc',
      body: {
        phone_status: 'DONE',
        bvn_status: 'NOT_DONE',
        nin_status: 'PROCESSING',
        selfie_status: 'NOT_DONE',
        bank_status: 'private-account',
        nin: '12345678901',
      },
    },
    hosts
  );
  expect(kyc).toMatchObject({
    verification: {
      phone_status: 'DONE',
      bvn_status: 'NOT_DONE',
      nin_status: 'PROCESSING',
      selfie_status: 'NOT_DONE',
    },
  });
  expect(JSON.stringify(kyc)).not.toMatch(/private-account|12345678901/);
});
