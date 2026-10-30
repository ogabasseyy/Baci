import { describe, expect, it } from 'vitest';
import { analyseRecord, relationOfCredit } from './tsq-analysis';

const expected = {
  sourceWalletId: 'wallet-src-0001',
  destinationWalletId: 'wallet-dst-0002',
  amountKobo: 100000,
};

describe('analyseRecord', () => {
  it('recognises the docs-sample TSQ shape as lacking wallets, fee and currency', () => {
    const facts = analyseRecord(
      {
        reference: 'r',
        status: 'success',
        amount: 100000,
        recipient: '0123456789',
        bank: 'GTBank',
        created_at: 't',
      },
      expected
    );
    expect(facts).toMatchObject({
      hasAmount: true,
      hasStatus: true,
      hasCurrency: false,
      hasFee: false,
      sourceKey: null,
      destinationKey: null,
      namesSource: false,
      namesDestination: false,
      amountMatches: true,
    });
  });

  it('recognises a rich record that names both wallets, the fee and the currency', () => {
    const facts = analyseRecord(
      {
        status: 'successful',
        amount: 100000,
        currency: 'NGN',
        fee: 0,
        source_wallet: 'wallet-src-0001',
        destination_wallet: 'wallet-dst-0002',
      },
      expected
    );
    expect(facts).toMatchObject({
      namesSource: true,
      namesDestination: true,
      hasFee: true,
      feeKobo: 0,
      currencyIsNgn: true,
      sourceKey: 'source_wallet',
      destinationKey: 'destination_wallet',
    });
  });

  it('flags wallet fields that name a different wallet', () => {
    const facts = analyseRecord(
      { source_wallet: 'someone-else', destination_wallet: 'wallet-dst-0002' },
      expected
    );
    expect(facts.namesSource).toBe(false);
    expect(facts.namesDestination).toBe(true);
  });

  it('copes with non-object input and unknown expectations', () => {
    expect(analyseRecord(null, expected).fieldNames).toEqual([]);
    expect(
      analyseRecord(
        { source_wallet: 'x' },
        { ...expected, sourceWalletId: null }
      ).namesSource
    ).toBeNull();
  });
});

describe('relationOfCredit', () => {
  it('classifies gross, net of fee, other and none', () => {
    expect(relationOfCredit(200000, 200000, 5000)).toBe('gross');
    expect(relationOfCredit(200000, 195000, 5000)).toBe('net_of_fee');
    expect(relationOfCredit(200000, 190000, 5000)).toBe('other');
    expect(relationOfCredit(200000, 195000, null)).toBe('other');
    expect(relationOfCredit(200000, 0, 5000)).toBe('none');
    expect(relationOfCredit(200000, null, 5000)).toBe('none');
  });
});
