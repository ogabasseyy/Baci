import './test-env.test-setup.mjs';
import { describe, expect, it } from 'vitest';
import { readChatwootCookieMetadata } from './cookie-diagnostics.mjs';

describe('readChatwootCookieMetadata', () => {
  it('returns metadata for Chatwoot cookies only and never the cookie values', async () => {
    const context = {
      cookies: async () => [
        {
          name: 'cw_conversation',
          value: 'SECRET1',
          domain: 'localhost',
          path: '/',
          sameSite: 'Lax',
          secure: true,
          httpOnly: false,
        },
        {
          name: 'cw_user_abc',
          value: 'SECRET2',
          domain: 'localhost',
          path: '/',
          sameSite: 'Lax',
          secure: true,
          httpOnly: false,
        },
        {
          name: 'cw_other',
          value: 'SECRET3',
          domain: 'localhost',
          path: '/',
          sameSite: 'Lax',
          secure: true,
          httpOnly: false,
        },
        {
          name: 'session',
          value: 'SECRET4',
          domain: 'localhost',
          path: '/',
          sameSite: 'Lax',
          secure: true,
          httpOnly: true,
        },
      ],
    };
    const result = await readChatwootCookieMetadata(context);
    expect(result.map((c) => c.name)).toEqual([
      'conversation',
      'user',
      'other',
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('returns an empty list when there are no cookies', async () => {
    expect(
      await readChatwootCookieMetadata({ cookies: async () => [] })
    ).toEqual([]);
  });
});
