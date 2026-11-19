import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PIGGYVEST_FEATURE_FLAGS } from './piggyvest-feature-flags';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import {
  readPrimaryWalletCardCheckoutRuntime,
  readPrimaryWalletCardCheckoutRuntimeDrain,
} from './primary-wallet-card-checkout-runtime';
import { enabledPrimaryCardRuntimeEnv } from './primary-wallet-card-checkout-runtime.test-support';

describe('enabled primary card runtime env test support', () => {
  it('sets every primary card variable the checkout runtime and abandonment CLI read', () => {
    const sources = [
      './primary-wallet-card-checkout-runtime.ts',
      '../../scripts/primary-wallet-card-checkout-abandonment-cli.ts',
    ].map((relative) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    );
    const consumed = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/\bPIGGYVEST_PRIMARY_CARD_[A-Z0-9_]+/g)].map(
          ([name]) => name
        )
      )
    );
    // The enable flag is read through the shared switch helper, not by name.
    consumed.add(PIGGYVEST_FEATURE_FLAGS.card_checkout);
    expect(consumed.size).toBeGreaterThan(0);
    const provided = Object.entries(enabledPrimaryCardRuntimeEnv).filter(
      ([name]) => name.startsWith('PIGGYVEST_PRIMARY_CARD_')
    );
    expect(provided.map(([name]) => name).sort()).toEqual([...consumed].sort());
    for (const [, value] of provided) expect(value).not.toBe('');
  });
  it('is accepted by the strict reader as a fully enabled rail', () => {
    expect(
      readPrimaryWalletCardCheckoutRuntime({ ...enabledPrimaryCardRuntimeEnv })
        ?.settings
    ).toEqual(fixture.settings);
  });
  it('is accepted by the drain reader with the evidence login', () => {
    expect(
      readPrimaryWalletCardCheckoutRuntimeDrain({
        ...enabledPrimaryCardRuntimeEnv,
      })?.evidence.login
    ).toBe('baci_primary_card_evidence');
  });
});
