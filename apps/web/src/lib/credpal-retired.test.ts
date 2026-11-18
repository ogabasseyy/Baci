// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';
import { openCredPalCheckout } from './credpal';

it('does not load or open the retired CredPal SDK', async () => {
  const append = vi.spyOn(document.head, 'appendChild');
  await expect(
    openCredPalCheckout({ key: 'fixture', amount: 100, product: 'fixture' })
  ).rejects.toThrow('CredPal is unavailable');
  expect(append).not.toHaveBeenCalled();
  append.mockRestore();
});
