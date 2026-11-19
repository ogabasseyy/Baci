import { describe, expect, it } from 'vitest';
import {
  type KudaBillItemLike,
  type KudaElectricityBillerLike,
  withKudaElectricityBillItems,
} from './kuda-electricity-bill-items';

interface TestBiller extends KudaElectricityBillerLike {
  billerId: string;
}

describe('withKudaElectricityBillItems', () => {
  it('handles an empty billers array', () => {
    const billers: TestBiller[] = [];

    expect(withKudaElectricityBillItems(billers)).toEqual([]);
  });

  it('adds the Kuda electricity bill item options for EKEDC providers', () => {
    const billers: TestBiller[] = [
      {
        billerId: 'a3cacf1f-c1d6-410f-b11d-4dc9d7ea5dd0',
        billerName: 'EKEDC NG',
      },
    ];
    const [biller] = withKudaElectricityBillItems(billers);

    expect(biller.billItems).toEqual([
      expect.objectContaining({
        itemCode: 'KUD-ELE-EKED-002',
        itemName: 'EKEDC PREPAID',
      }),
      expect.objectContaining({
        itemCode: 'KUD-ELE-EKED-001',
        itemName: 'EKEDC POSTPAID',
      }),
    ]);
  });

  it('normalizes EKEDC names with hyphen and underscore NG suffixes', () => {
    const billers: TestBiller[] = [
      {
        billerId: 'hyphen-id',
        billerName: 'EKEDC-NG',
      },
      {
        billerId: 'underscore-id',
        billerName: 'EKEDC_NG',
      },
    ];

    const result = withKudaElectricityBillItems(billers);

    expect(result[0].billItems).toEqual([
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-002' }),
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-001' }),
    ]);
    expect(result[1].billItems).toEqual([
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-002' }),
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-001' }),
    ]);
  });

  it.each([
    ['APLE NG', 'KUD-ELE-APLE-001', 'KUD-ELE-APLE-002'],
    ['JEDC NG', 'KUD-ELE-JEDC-001', 'KUD-ELE-JEDC-002'],
    ['YEDC NG', 'KUD-ELE-YEDC-001', 'KUD-ELE-YEDC-002'],
  ])('orders %s prepaid item before postpaid', (billerName, prepaid, postpaid) => {
    const billers: TestBiller[] = [
      {
        billerId: 'provider-id',
        billerName,
      },
    ];
    const [biller] = withKudaElectricityBillItems(billers);

    expect(biller.billItems?.map((item) => item.itemCode)).toEqual([
      prepaid,
      postpaid,
    ]);
  });

  it('preserves billers that already include bill items', () => {
    const billItems: KudaBillItemLike[] = [
      {
        amount: 0,
        isAmountFixed: false,
        itemCode: 'provider-item',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'Provider item',
      },
    ];
    const billers: TestBiller[] = [
      {
        billerId: 'provider-id',
        billerName: 'EKEDC NG',
        billItems,
      },
    ];
    const [biller] = withKudaElectricityBillItems(billers);

    expect(biller.billItems).toBe(billItems);
  });

  it('leaves unknown electricity providers unchanged', () => {
    const billers: TestBiller[] = [
      {
        billerId: 'provider-id',
        billerName: 'UNKNOWN NG',
      },
    ];
    const [biller] = withKudaElectricityBillItems(billers);

    expect(biller.billItems).toBeUndefined();
  });

  it('processes multiple billers with mixed scenarios', () => {
    const billItems: KudaBillItemLike[] = [
      {
        amount: 0,
        isAmountFixed: false,
        itemCode: 'provider-item',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'Provider item',
      },
    ];
    const billers: TestBiller[] = [
      {
        billerId: 'ekedc-id',
        billerName: 'EKEDC NG',
      },
      {
        billerId: 'unknown-id',
        billerName: 'UNKNOWN NG',
      },
      {
        billerId: 'existing-id',
        billerName: 'AEDC NG',
        billItems,
      },
    ];

    const result = withKudaElectricityBillItems(billers);

    expect(result[0].billItems).toEqual([
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-002' }),
      expect.objectContaining({ itemCode: 'KUD-ELE-EKED-001' }),
    ]);
    expect(result[1].billItems).toBeUndefined();
    expect(result[2].billItems).toBe(billItems);
  });
});
