import { describe, expect, it, vi } from 'vitest';
import { handleOnboardingEmailPreferences } from './preferences-handler';

const token = '12345678-1234-4123-8123-123456789abc';
describe('onboarding reminder opt-out', () => {
  it('does not unsubscribe on GET, including email scanner visits', async () => {
    const stop = vi.fn();
    const response = await handleOnboardingEmailPreferences(
      new Request(`https://example.com?token=${token}`),
      stop
    );
    expect(response.status).toBe(200);
    expect(stop).not.toHaveBeenCalled();
    expect(await response.text()).toContain('method="post"');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
  it('unsubscribes only with a valid opaque token on POST', async () => {
    const stop = vi.fn();
    const response = await handleOnboardingEmailPreferences(
      new Request('https://example.com', {
        method: 'POST',
        body: new URLSearchParams({ token }),
      }),
      stop
    );
    expect(response.status).toBe(200);
    expect(stop).toHaveBeenCalledWith(token);
  });
  it('rejects invalid tokens without reaching the database', async () => {
    const stop = vi.fn();
    expect(
      (
        await handleOnboardingEmailPreferences(
          new Request('https://example.com?token=bad'),
          stop
        )
      ).status
    ).toBe(400);
    expect(stop).not.toHaveBeenCalled();
  });
  it('reports errors without claiming success or exposing details', async () => {
    const stop = vi.fn().mockRejectedValue(Error('secret'));
    const response = await handleOnboardingEmailPreferences(
      new Request('https://example.com', {
        method: 'POST',
        body: new URLSearchParams({ token }),
      }),
      stop
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
});
