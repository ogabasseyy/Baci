import { describe, expect, it } from 'vitest';
import { readsAsMonnifyAuthRejection } from './monnify-auth-rejection';

describe('readsAsMonnifyAuthRejection', () => {
  it.each([
    JSON.stringify({ responseMessage: 'Unauthorized' }),
    JSON.stringify({ responseMessage: 'Forbidden.' }),
    'Unauthorized',
    JSON.stringify({ responseMessage: 'Access denied' }),
    JSON.stringify({ error: 'Forbidden: invalid credentials' }),
    JSON.stringify({ message: 'Unauthorized request' }),
    'Token expired',
  ])('reads %s as an auth rejection', (body) => {
    expect(readsAsMonnifyAuthRejection(body)).toBe(true);
  });

  it.each([
    '',
    JSON.stringify({
      responseMessage: 'Gateway policy: forbidden region list updated',
    }),
    JSON.stringify({ responseMessage: 'Request rejected' }),
    'See unauthorized-use policy',
  ])('does not read %s as an auth rejection', (body) => {
    expect(readsAsMonnifyAuthRejection(body)).toBe(false);
  });
});
