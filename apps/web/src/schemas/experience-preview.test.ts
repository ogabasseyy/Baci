import { expect, it } from 'vitest';
import { experiencePreviewInput } from './experience-preview';

it('preview request accepts a build/route locator without caller authority or publication flags', () => {
  const good = {
    merchantId: '10000000-0000-4000-8000-000000000001',
    buildId: '20000000-0000-4000-8000-000000000001',
    routeId: 'home',
  };
  expect(experiencePreviewInput.safeParse(good).success).toBe(true);
  expect(
    experiencePreviewInput.safeParse({
      ...good,
      ownerId: 'forged',
      publish: true,
    }).success
  ).toBe(false);
});

it('validates optional page route locators without allowing oversized values', async () => {
  const { experiencePreviewPageInput } = await import('./experience-preview');
  const value = {
    merchant: '11111111-1111-4111-8111-111111111111',
    build: '22222222-2222-4222-8222-222222222222',
  };
  expect(experiencePreviewPageInput.safeParse(value).success).toBe(true);
  expect(
    experiencePreviewPageInput.safeParse({
      ...value,
      routeId: '/collections/all',
    }).success
  ).toBe(true);
  for (const routeId of ['', 'x'.repeat(241)])
    expect(
      experiencePreviewPageInput.safeParse({ ...value, routeId }).success
    ).toBe(false);
});
