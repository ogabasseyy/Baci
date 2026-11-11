// @vitest-environment node
import { expect, it } from 'vitest';
import {
  resolveExperienceCartContinuity,
  verifyContinuitySubject,
} from './experience-cart-continuity';

const p = {
  merchantId: 'm',
  cartId: 'c',
  grantId: 'g',
  principalId: 'p',
  scope: 'session' as const,
  allowedOperations: [],
  expiresAt: '2030-01-01T00:00:00Z',
};
it('binds opaque continuity to live grant and verified subject, not proof renewal', async () => {
  const subject = await verifyContinuitySubject(async () => ({
    data: { user: { id: 'customer-a' } },
    error: null,
  }));
  const hint = resolveExperienceCartContinuity(p, subject);
  expect(hint).toMatch(/^[a-f0-9]{64}$/);
  expect(
    resolveExperienceCartContinuity(
      { ...p, expiresAt: '2031-01-01T00:00:00Z' },
      subject
    )
  ).toBe(hint);
  expect(
    resolveExperienceCartContinuity({ ...p, grantId: 'different' }, subject)
  ).not.toBe(hint);
  const b = await verifyContinuitySubject(async () => ({
    data: { user: { id: 'customer-b' } },
    error: null,
  }));
  expect(resolveExperienceCartContinuity(p, b)).not.toBe(hint);
  expect(hint).not.toContain('customer');
});
it('fails closed on unknown auth failures and distinguishes positively absent guest', async () => {
  await expect(
    verifyContinuitySubject(async () => ({
      data: { user: null },
      error: { name: 'NetworkError' },
    }))
  ).rejects.toThrow();
  const guest = await verifyContinuitySubject(async () => ({
    data: { user: null },
    error: { name: 'AuthSessionMissingError' },
  }));
  expect(resolveExperienceCartContinuity(p, guest)).toMatch(/^[a-f0-9]{64}$/);
  expect(() =>
    resolveExperienceCartContinuity({ ...p, grantId: null }, guest)
  ).toThrow();
});
