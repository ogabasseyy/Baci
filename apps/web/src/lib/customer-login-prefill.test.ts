import { describe, expect, it, vi } from 'vitest';
import {
  fetchCustomerLoginEmailHintForRedirect,
  getReceiptClaimTokenFromLoginRedirect,
  sanitizeCustomerLoginEmailPrefill,
} from './customer-login-prefill';

describe('sanitizeCustomerLoginEmailPrefill', () => {
  it('normalizes valid email hints for login prefill', () => {
    expect(
      sanitizeCustomerLoginEmailPrefill('  BasseyBJohn@Yahoo.CO.UK  ')
    ).toBe('basseybjohn@yahoo.co.uk');
  });

  it('drops missing or invalid email hints', () => {
    expect(sanitizeCustomerLoginEmailPrefill(null)).toBe('');
    expect(sanitizeCustomerLoginEmailPrefill('not-an-email')).toBe('');
    expect(sanitizeCustomerLoginEmailPrefill('https://evil.example')).toBe('');
  });
});

describe('getReceiptClaimTokenFromLoginRedirect', () => {
  it('extracts receipt claim tokens from safe login redirects', () => {
    expect(
      getReceiptClaimTokenFromLoginRedirect('/receipts/claim/token_123')
    ).toBe('token_123');
    expect(
      getReceiptClaimTokenFromLoginRedirect(
        '/receipts/claim/token_123?from=email'
      )
    ).toBe('token_123');
  });

  it('extracts tokens beneath a storefront base path', () => {
    expect(
      getReceiptClaimTokenFromLoginRedirect(
        '/ogabassey/receipts/claim/token_123'
      )
    ).toBe('token_123');
    expect(
      getReceiptClaimTokenFromLoginRedirect(
        '/ogabassey/receipts/claim/token_123?from=email'
      )
    ).toBe('token_123');
  });

  it('ignores non-claim redirects', () => {
    expect(getReceiptClaimTokenFromLoginRedirect('/receipts')).toBeNull();
    expect(
      getReceiptClaimTokenFromLoginRedirect('/account?redirect=/receipts')
    ).toBeNull();
    expect(
      getReceiptClaimTokenFromLoginRedirect(
        '/account?redirect=/receipts/claim/token_123'
      )
    ).toBeNull();
  });
});

describe('fetchCustomerLoginEmailHintForRedirect', () => {
  it('loads the masked email hint for receipt claim redirects', async () => {
    const fetchImpl = (_url: string | URL | Request) =>
      Promise.resolve(
        new Response(JSON.stringify({ emailHint: 'b***@yahoo.co.uk' }), {
          status: 200,
        })
      );

    await expect(
      fetchCustomerLoginEmailHintForRedirect(
        '/receipts/claim/token_123',
        fetchImpl
      )
    ).resolves.toBe('b***@yahoo.co.uk');
  });

  it('drops unmasked addresses from hint responses', async () => {
    const fetchImpl = (_url: string | URL | Request) =>
      Promise.resolve(
        new Response(JSON.stringify({ emailHint: 'basseybjohn@yahoo.co.uk' }), {
          status: 200,
        })
      );

    await expect(
      fetchCustomerLoginEmailHintForRedirect(
        '/receipts/claim/token_123',
        fetchImpl
      )
    ).resolves.toBe('');
  });

  it('does not fetch email hints for non-claim redirects', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      fetchCustomerLoginEmailHintForRedirect('/receipts', fetchImpl)
    ).resolves.toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops failed or invalid email hint responses', async () => {
    const failedFetch = () =>
      Promise.resolve(new Response(null, { status: 404 }));
    const invalidEmailFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ emailHint: 'not-a-hint' }), {
          status: 200,
        })
      );

    await expect(
      fetchCustomerLoginEmailHintForRedirect(
        '/receipts/claim/token_123',
        failedFetch
      )
    ).resolves.toBe('');
    await expect(
      fetchCustomerLoginEmailHintForRedirect(
        '/receipts/claim/token_123',
        invalidEmailFetch
      )
    ).resolves.toBe('');
  });

  it('handles email hint fetch failures', async () => {
    const fetchImpl = () => Promise.reject(new Error('network failed'));

    await expect(
      fetchCustomerLoginEmailHintForRedirect(
        '/receipts/claim/token_123',
        fetchImpl
      )
    ).resolves.toBe('');
  });
});
