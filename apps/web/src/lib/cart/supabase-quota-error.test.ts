import { expect, it } from 'vitest';
import { SupabaseQuotaCounterError } from './supabase-quota-error';

it('reports an allowlisted reason with a fixed safe message', () => {
  const error = new SupabaseQuotaCounterError('invalid_response');
  expect(error.reason).toBe('invalid_response');
  expect(error.message).toBe('Cart quota counter unavailable');
  expect(error.name).toBe('SupabaseQuotaCounterError');
});
