import { describe, expect, it, vi } from 'vitest';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';
import {
  fixture,
  goalId,
  ready,
  scope,
  walletName,
} from './primary-savings-provisioning.input.test-support';

vi.mock('server-only', () => ({}));

/**
 * PiggyVest rewrites sub-wallet names (sandbox, 2026-10-31: every `-` was
 * gone when the wallet was listed back). `baci-save-<hash>` can therefore
 * list as letters and digits only.
 */
const sanitisedName = walletName.replace(/[^A-Za-z0-9]/g, '');

describe('bugfix: savings-goal provisioning reconciles provider-sanitised names', () => {
  it('adopts a sanitised listed wallet on a reclaimed claim instead of reposting creation', async () => {
    const input = fixture();
    const listed = { id: 'destination', name: sanitisedName, status: 'active' };
    input.listWallets.mockResolvedValue([listed]);
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      name: sanitisedName,
    });

    expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.record).toHaveBeenCalledWith(
      goalId,
      'claim',
      'destination'
    );
    // The proof keeps the provider's own name: the database, not this
    // module, decides whether it binds to the stored intent.
    expect(input.store.enroll).toHaveBeenCalledWith(
      goalId,
      expect.objectContaining({
        providerWalletId: 'destination',
        walletName: sanitisedName,
      })
    );
  });

  it('quarantines an exact and a sanitised wallet as ambiguous without selecting one', async () => {
    const input = fixture();
    input.listWallets.mockResolvedValue([
      { id: 'destination', name: walletName, status: 'active' },
      { id: 'other', name: sanitisedName, status: 'active' },
    ]);

    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.record).not.toHaveBeenCalled();
    expect(input.store.enroll).not.toHaveBeenCalled();
  });

  it('recovers a sanitised listed wallet by reads alone', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.listWallets.mockResolvedValue([
      { id: 'destination', name: sanitisedName, status: 'active' },
    ]);
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      name: sanitisedName.toLowerCase(),
    });

    expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
    expect(input.createWallet).not.toHaveBeenCalled();
  });

  it('refuses a retrieved wallet whose name differs beyond punctuation and case', async () => {
    const input = fixture();
    input.mode = 'recover';
    input.retrieveWallet.mockResolvedValue({
      ...(await input.retrieveWallet()),
      name: `${sanitisedName}0`,
    });

    expect((await provisionPrimarySavingsWallet(input)).status).toBe(
      'conflict'
    );
    expect(input.store.enroll).not.toHaveBeenCalled();
  });

  describe('legacy pre-short-name goal wallet names', () => {
    // 'baci-save:<integration>:<goal>' (83 characters): the migration keeps
    // it only on intents that already hold a provider wallet.
    const legacyName = `baci-save:${scope.integrationId}:${goalId}`;

    it('keeps serving a wallet-bound goal under its legacy name, and lists by that name', async () => {
      const input = fixture();
      input.mode = 'recover';
      input.store.read.mockResolvedValue({
        ...(await input.store.read()),
        walletName: legacyName,
        providerWalletId: 'destination',
      });
      input.listWallets.mockResolvedValue([
        { id: 'destination', name: legacyName, status: 'active' },
      ]);
      input.retrieveWallet.mockResolvedValue({
        ...(await input.retrieveWallet()),
        name: legacyName,
      });
      expect(await provisionPrimarySavingsWallet(input)).toEqual(ready);
      expect(input.listWallets).toHaveBeenCalledWith('customer', legacyName);
      expect(input.createWallet).not.toHaveBeenCalled();
    });

    it('refuses the legacy name on an intent that has no provider wallet yet', async () => {
      const input = fixture();
      input.mode = 'recover';
      input.store.read.mockResolvedValue({
        ...(await input.store.read()),
        walletName: legacyName,
        providerWalletId: null,
      });
      expect((await provisionPrimarySavingsWallet(input)).status).toBe(
        'conflict'
      );
      expect(input.listWallets).not.toHaveBeenCalled();
      expect(input.createWallet).not.toHaveBeenCalled();
    });

    it('lists by the current name for a current-name intent', async () => {
      const input = fixture();
      input.mode = 'recover';
      await provisionPrimarySavingsWallet(input);
      expect(input.listWallets).toHaveBeenCalledWith('customer', walletName);
    });
  });
});
