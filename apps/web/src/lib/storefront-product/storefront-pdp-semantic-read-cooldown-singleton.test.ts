import { afterEach, expect, it } from 'vitest';
import { storefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-singleton';

afterEach(() => storefrontPdpSemanticReadCooldown.reset());

it('provides a shared cooldown store that can be reset across scopes', () => {
  storefrontPdpSemanticReadCooldown.markFailure('singleton-test', 100);
  storefrontPdpSemanticReadCooldown.markFailure('singleton-test-2', 100);
  expect(
    storefrontPdpSemanticReadCooldown.isCoolingDown('singleton-test', 101)
  ).toBe(true);
  storefrontPdpSemanticReadCooldown.reset();
  expect(
    storefrontPdpSemanticReadCooldown.isCoolingDown('singleton-test', 101)
  ).toBe(false);
  expect(
    storefrontPdpSemanticReadCooldown.isCoolingDown('singleton-test-2', 101)
  ).toBe(false);
});
