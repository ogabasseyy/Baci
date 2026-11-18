import { describe, expect, it } from 'vitest';
import { readsAsMonnifyAuthRejection } from './monnify-auth-rejection';

describe('readsAsMonnifyAuthRejection', () => {
  it.each([
    JSON.stringify({ responseMessage: 'Unauthorized' }),
    JSON.stringify({ responseMessage: 'Forbidden.' }),
    'Unauthorized',
    JSON.stringify({ responseMessage: 'Access denied' }),
    JSON.stringify({ error: 'Forbidden: invalid credentials' }),
    JSON.stringify({ message: 'Unauthorized: access token' }),
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

describe('readsAsMonnifyAuthRejection with specificOnly', () => {
  it.each([
    JSON.stringify({ responseMessage: 'Access denied' }),
    JSON.stringify({ responseMessage: 'Forbidden' }),
  ])('does not read bare %s as specific', (body) => {
    expect(readsAsMonnifyAuthRejection(body, { specificOnly: true })).toBe(
      false
    );
  });

  it('reads a named token problem as specific', () => {
    expect(
      readsAsMonnifyAuthRejection(
        JSON.stringify({ responseMessage: 'Invalid bearer token' }),
        {
          specificOnly: true,
        }
      )
    ).toBe(true);
  });
});

describe('bugfix: generic denies are not specific auth rejections', () => {
  it.each([
    'Unauthorized request',
    'Forbidden access',
    'Unauthorized client',
  ])('does not read "%s" as a specific auth rejection', (message) => {
    expect(
      readsAsMonnifyAuthRejection(
        JSON.stringify({ responseMessage: message }),
        {
          specificOnly: true,
        }
      )
    ).toBe(false);
  });
});
