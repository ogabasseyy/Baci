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
