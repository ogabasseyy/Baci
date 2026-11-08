import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OxygenBankLogo } from './OxygenBankLogo';
import { oxygenBankLogo } from './oxygen-bank-logos';

function logoPath(code: string): string | undefined {
  // Vitest resolves static image imports to asset URLs, while a Next.js
  // production build resolves the same imports to StaticImageData objects.
  const logo: unknown = oxygenBankLogo(code);
  if (typeof logo === 'string') return logo;
  if (logo && typeof logo === 'object' && 'src' in logo) {
    return typeof logo.src === 'string' ? logo.src : undefined;
  }
  return undefined;
}

describe('bugfix: bank logos on custom domains', () => {
  it('returns a bundled asset instead of the runtime /bank-logos URL', () => {
    const path = logoPath('058');

    expect(path).toBeDefined();
    expect(path).toMatch(/058[^/]*\.png$/);
    expect(path).not.toMatch(/^\/bank-logos\//);
  });

  it('keeps every alias on the same bundled asset', () => {
    expect(oxygenBankLogo('000013')).toBe(oxygenBankLogo('058'));
  });
});

it('matches exact Oxygen codes and aliases without guessing or normalizing unknown codes', () => {
  expect(oxygenBankLogo('058')).toBeDefined();
  expect(oxygenBankLogo('000013')).toBe(oxygenBankLogo('058'));
  expect(oxygenBankLogo('999992')).toBeDefined();
  for (const code of ['58', 'unknown', '', '__proto__'])
    expect(oxygenBankLogo(code)).toBeUndefined();
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
