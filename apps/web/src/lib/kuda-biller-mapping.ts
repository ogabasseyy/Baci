import type { Biller } from './kuda';
import { type BillItem, mapKudaBillItems } from './kuda-bill-items';
import { normalizeKudaItemCode } from './kuda-item-code';
import { collectRawFixedItemCodes } from './kuda-raw-fixed-item-codes';
import { collectRawFixedPricesKobo } from './kuda-raw-fixed-prices';

/** A biller as Kuda returns it (camelCase in production). */
export interface KudaCamelBiller {
  id: string;
  name: string;
  description: string;
  billerIconUrl?: string;
  billTypeId: string;
  billItems?: unknown;
}

/**
 * Raw biller shape returned by Kuda API (PascalCase).
 * See: https://docs.kuda.com/ — GET_BILLERS_BY_TYPE
 */
export interface KudaPascalBiller {
  Id: string;
  Name: string;
  Description: string;
  BillerIconUrl?: string;
  BillTypeId: string;
  BillItems?: unknown;
}

function keptFixedItemCodes(items: BillItem[] | undefined, codes: Set<string>) {
  for (const item of items ?? []) {
    if (item.isAmountFixed) codes.add(normalizeKudaItemCode(item.itemCode));
    keptFixedItemCodes(item.billItems, codes);
  }
  return codes;
}

function toBiller(
  fields: Omit<Biller, 'billItems' | 'unreadableItemCodes'>,
  rawItems: unknown
): Biller {
  const billItems = mapKudaBillItems(rawItems);
  // Every fixed-price listing the mapper dropped, whatever the reason (an
  // unusable price, a list whose unit is in doubt, malformed children), so
  // the price recheck never mistakes it for a package the biller lacks.
  const kept = keptFixedItemCodes(billItems, new Set());
  const unreadableItemCodes = [
    ...new Set(collectRawFixedItemCodes(rawItems)),
  ].filter((code) => !kept.has(normalizeKudaItemCode(code)));
  return {
    ...fields,
    billItems,
    ...(unreadableItemCodes.length > 0 && { unreadableItemCodes }),
  };
}

/**
 * Map Kuda's GET_BILLERS_BY_TYPE answer (camelCase in production, PascalCase
 * in legacy/test answers) to our billers, plus every fixed price exactly as
 * Kuda sent it (kobo), read before any item is mapped or dropped.
 */
export function mapKudaBillersAnswer(
  answer: { billers?: KudaCamelBiller[]; Billers?: KudaPascalBiller[] },
  billTypeName: string
): { billers: Biller[]; rawFixedPricesKobo: number[] } {
  const camel = answer.billers;
  if (camel && camel.length > 0) {
    return {
      billers: camel.map((raw) =>
        toBiller(
          {
            billerId: raw.id,
            billerName: raw.name,
            billerType: raw.description,
            categoryId: raw.billTypeId,
            categoryName: billTypeName,
            billerIconUrl: raw.billerIconUrl,
          },
          raw.billItems
        )
      ),
      rawFixedPricesKobo: camel.flatMap((raw) =>
        collectRawFixedPricesKobo(raw.billItems)
      ),
    };
  }
  const pascal = answer.Billers;
  if (pascal && pascal.length > 0) {
    return {
      billers: pascal.map((raw) =>
        toBiller(
          {
            billerId: raw.Id,
            billerName: raw.Name,
            billerType: raw.Description,
            categoryId: raw.BillTypeId,
            categoryName: billTypeName,
            billerIconUrl: raw.BillerIconUrl,
          },
          raw.BillItems
        )
      ),
      rawFixedPricesKobo: pascal.flatMap((raw) =>
        collectRawFixedPricesKobo(raw.BillItems)
      ),
    };
  }
  return { billers: [], rawFixedPricesKobo: [] };
}
