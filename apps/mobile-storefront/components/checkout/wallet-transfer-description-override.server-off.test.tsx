import { describe, expect, it } from '@jest/globals';
import {
  WALLET_TRANSFER_CHECKING_COPY,
  walletTransferDescriptionOverride,
} from './wallet-transfer-description-override';

describe('walletTransferDescriptionOverride', () => {
  it("keeps today's row (no override) when the option is off and nothing is checking", () => {
    expect(walletTransferDescriptionOverride(false, false)).toBeUndefined();
  });

  it('describes the permanent account when the option is available', () => {
    expect(
      walletTransferDescriptionOverride(true, false)?.bank_transfer
    ).toContain('permanent account number');
  });

  it('says "Checking…" only while a verdict is being checked', () => {
    expect(walletTransferDescriptionOverride(false, true)?.bank_transfer).toBe(
      WALLET_TRANSFER_CHECKING_COPY
    );
  });
});
