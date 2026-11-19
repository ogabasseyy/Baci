import { KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER } from './kuda-electricity-provider-items';

export interface KudaBillItemLike {
  amount: number;
  itemCode: string;
  itemName: string;
  itemCurrencySymbol: string;
  isAmountFixed: boolean;
  itemFee: number;
}

export interface KudaElectricityBillerLike {
  billerName: string;
  billItems?: KudaBillItemLike[];
}

type KudaBillItemDefinition =
  (typeof KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER)[string][number];

function normalizeElectricityBillerName(billerName: string) {
  return billerName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/NG$/, '');
}

function createElectricityBillItem(
  item: KudaBillItemDefinition
): KudaBillItemLike {
  return {
    amount: 0,
    isAmountFixed: false,
    itemCode: item.itemCode,
    itemCurrencySymbol: 'NGN',
    itemFee: 0,
    itemName: item.itemName,
  };
}

export function withKudaElectricityBillItems<
  Biller extends KudaElectricityBillerLike,
>(billers: Biller[]): Biller[] {
  return billers.map((biller) => {
    if (biller.billItems?.length) {
      return biller;
    }

    const billItems =
      KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER[
        normalizeElectricityBillerName(biller.billerName)
      ];
    if (!billItems) {
      return biller;
    }

    return {
      ...biller,
      billItems: billItems.map((item) => createElectricityBillItem(item)),
    };
  });
}
