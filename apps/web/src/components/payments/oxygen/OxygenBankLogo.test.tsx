import { existsSync } from 'node:fs';
import { fireEvent, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenBankLogo } from './OxygenBankLogo';
import { oxygenBankLogo } from './oxygen-bank-logos';

it('matches exact Oxygen codes and aliases without guessing or normalizing unknown codes', () => {
  expect(oxygenBankLogo('058')).toBe('/bank-logos/058.png');
  expect(oxygenBankLogo('000013')).toBe('/bank-logos/058.png');
  expect(oxygenBankLogo('999992')).toBe('/bank-logos/999992.png');
  for (const code of ['58', 'unknown', '', '__proto__'])
    expect(oxygenBankLogo(code)).toBeUndefined();
  expect(existsSync(`public${oxygenBankLogo('058')}`)).toBe(true);
});

it('falls back for unknown codes and broken images, and recovers when the bank changes', () => {
  const view = render(<OxygenBankLogo code="unknown" />);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelector('svg')).not.toBeNull();
  view.rerender(<OxygenBankLogo code="058" />);
  const logo = view.container.querySelector('img');
  expect(logo).not.toBeNull();
  if (!logo) throw new Error('Expected bank logo');
  fireEvent.error(logo);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelector('svg')).not.toBeNull();
  view.rerender(<OxygenBankLogo code="044" />);
  expect(view.container.querySelector('img')).not.toBeNull();
});
