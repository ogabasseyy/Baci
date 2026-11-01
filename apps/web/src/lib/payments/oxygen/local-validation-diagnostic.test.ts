import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { oxygenProviderDiagnosticSchema } from '@/schemas/oxygen-provider-diagnostic';
import {
  OxygenLocalValidationError,
  oxygenLocalValidationDiagnostic,
} from './local-validation-diagnostic';
import { createOxygenProvider } from './provider';
import { projectOxygenResponse } from './response-evidence';

vi.mock('server-only', () => ({}));
const metadata = {
  operation: 'eligibility' as const,
  httpStatus: 200,
  capture: 'parsed' as const,
  durationMs: 42,
  requestId: 'private-header',
};
it('bounds schema issues and never records arbitrary keys, messages or input', () => {
  const result = z
    .object({
      eligible_amount: z.number(),
      'private-key': z.literal('private-expected'),
    })
    .safeParse({
      eligible_amount: 'private-input',
      'private-key': 'private-input',
    });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected schema failure');
  const diagnostic = oxygenLocalValidationDiagnostic(
    result.error,
    'eligibility',
    metadata,
    Date.now()
  );
  expect(oxygenProviderDiagnosticSchema.safeParse(diagnostic).success).toBe(
    true
  );
  expect(diagnostic.providerMessage).toContain('eligible_amount');
  expect(JSON.stringify(diagnostic)).not.toContain('private-');
  expect(diagnostic.providerRequestId).toBeNull();
});
it.each([
  'reference_mismatch',
  'required_field_missing',
] as const)('identifies %s without retaining values', (reason) => {
  const diagnostic = oxygenLocalValidationDiagnostic(
    new OxygenLocalValidationError(reason, ['partner_reference']),
    'eligibility',
    metadata,
    Date.now()
  );
  expect(JSON.parse(diagnostic.providerMessage ?? '{}')).toEqual({
    check: reason,
    fields: ['partner_reference'],
  });
  expect(diagnostic.httpStatus).toBe(200);
});
it('does not attach stale metadata or arbitrary error text', () => {
  const diagnostic = oxygenLocalValidationDiagnostic(
    new Error('private-error'),
    'kyc',
    metadata,
    Date.now()
  );
  expect(diagnostic.httpStatus).toBeNull();
  expect(diagnostic.outcome).toBe('not_sent');
  expect(JSON.stringify(diagnostic)).not.toContain('private-error');
});
it('retains HTTP metadata without response bodies and clears it before the next call', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ private: 'private-body' }, { status: 201 })
    )
    .mockRejectedValueOnce(new Error('private-network'));
  const provider = createOxygenProvider({
    token: async () => 'private-token',
    fetch: fetcher,
  });
  await provider.call('eligibility', {});
  expect(provider.responseMetadata?.()).toMatchObject({
    operation: 'eligibility',
    httpStatus: 201,
    capture: 'parsed',
  });
  expect(JSON.stringify(provider.responseMetadata?.())).not.toContain(
    'private'
  );
  await expect(provider.call('kyc', {})).rejects.toThrow();
  expect(provider.responseMetadata?.()).toBeUndefined();
});
it('captures eligibility status and limits with missing/type information, excluding identity and free text', () => {
  const projected = projectOxygenResponse(
    {
      ...metadata,
      body: {
        status: 'COMPLETED',
        is_eligible: true,
        eligible_amount: 200000,
        max_tenure: 6,
        minimum_loan_amount: 'private-invalid',
        loan_request_reference: 'private-reference',
        message: 'private-message',
        bvn: 'private-identity',
      },
    },
    new Set()
  );
  expect(projected.eligibility).toMatchObject({
    values: {
      status: 'COMPLETED',
      is_eligible: true,
      eligible_amount: 200000,
      max_tenure: 6,
    },
    shape: { minimum_loan_amount: 'string', max_loan_amount: 'missing' },
  });
  expect(JSON.stringify(projected)).not.toContain('private-');
});
