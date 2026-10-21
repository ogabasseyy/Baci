import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/storefront/templates/gadget-default-template', () => ({
  GadgetDefaultTemplate: () => null,
}));

vi.mock('@/components/storefront/templates/premium-default', () => ({
  PremiumDefaultTemplate: () => null,
}));

import {
  loadElectronicsTemplateHome,
  loadFashionTemplateHome,
} from './registry-client-home-loaders';

describe('registry-client-home-loaders', () => {
  it('resolves electronics and fashion template home components', async () => {
    expect(typeof (await loadElectronicsTemplateHome())).toBe('function');
    expect(typeof (await loadFashionTemplateHome())).toBe('function');
  });
});
