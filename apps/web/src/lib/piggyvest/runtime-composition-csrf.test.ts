import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCompositionCsrf } from './runtime-composition-csrf';

vi.mock('server-only', () => ({}));
const origin = 'http://127.0.0.1:4181';
const actor = '90000000-0000-4000-8000-000000000001';
const goalId = '30000000-0000-4000-8000-000000000701';
const request = (session = 'owner', token?: string) =>
  new NextRequest(`${origin}/policy`, {
    method: 'POST',
    headers: {
      origin,
      cookie: `synthetic-session=${session}${token ? `; piggyvest-csrf=${token}` : ''}`,
      ...(token ? { 'x-csrf-token': token } : {}),
    },
  });

describe('session-bound CSRF bootstrap', () => {
  it('accepts only its signed token for the same verified actor and cookies', async () => {
    const csrf = createRuntimeCompositionCsrf({ origin, goalId });
    const response = csrf.bootstrap(request(), actor);
    const { csrfToken } = await response.json();
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await csrf.check(request('owner', csrfToken), actor)).valid).toBe(
      true
    );
    expect((await csrf.check(request('other', csrfToken), actor)).valid).toBe(
      false
    );
    expect((await csrf.check(request('owner', csrfToken), 'other')).valid).toBe(
      false
    );
    expect((await csrf.check(request('owner', 'unsigned'), actor)).valid).toBe(
      false
    );
    expect(
      (
        await createRuntimeCompositionCsrf({
          origin,
          goalId,
          secret: Uint8Array.from({ length: 32 }, (_, index) => index),
        }).check(request('owner', csrfToken), actor)
      ).valid
    ).toBe(false);
    expect(
      (
        await createRuntimeCompositionCsrf({
          origin,
          goalId: '30000000-0000-4000-8000-000000000702',
        }).check(request('owner', csrfToken), actor)
      ).valid
    ).toBe(false);
  });
  it('expires tokens and rejects low-entropy secret injection', async () => {
    vi.useFakeTimers();
    try {
      const csrf = createRuntimeCompositionCsrf({ origin, goalId });
      const { csrfToken } = await csrf.bootstrap(request(), actor).json();
      vi.advanceTimersByTime(900001);
      expect((await csrf.check(request('owner', csrfToken), actor)).valid).toBe(
        false
      );
      expect(() =>
        createRuntimeCompositionCsrf({
          origin,
          goalId,
          secret: new Uint8Array(32),
        })
      ).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
