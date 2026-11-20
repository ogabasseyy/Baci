import type { Biller } from './kuda';
import { type BillItem, mapKudaBillItems } from './kuda-bill-items';
import { normalizeKudaItemCode } from './kuda-item-code';
import { collectRawFixedItemCodes } from './kuda-raw-fixed-item-codes';
import { collectRawFixedPricesKobo } from './kuda-raw-fixed-prices';
import { hasMalformedItemList } from './kuda-raw-malformed-items';

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

/** How many fixed listings of each (normalized) code the mapper kept. */
function keptFixedItemCodes(
  items: BillItem[] | undefined,
  counts: Map<string, number>
) {
  for (const item of items ?? []) {
    if (item.isAmountFixed) {
      const code = normalizeKudaItemCode(item.itemCode);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    keptFixedItemCodes(item.billItems, counts);
  }
  return counts;
}

function toBiller(
  fields: Omit<
    Biller,
    'billItems' | 'unreadableItemCodes' | 'packagesUnreadable'
  >,
  rawItems: unknown
): Biller {
  const billItems = mapKudaBillItems(rawItems);
  // Every fixed-price listing the mapper dropped, whatever the reason (an
  // unusable price, a list whose unit is in doubt, malformed children), so
  // the price recheck never mistakes it for a package the biller lacks.
  // Counted per code, so a code listed twice with only one copy dropped is
  // still marked: the dropped copy's current price is unconfirmable.
  const kept = keptFixedItemCodes(billItems, new Map());
  const sent = new Map<string, { code: string; count: number }>();
  for (const code of collectRawFixedItemCodes(rawItems)) {
    const key = normalizeKudaItemCode(code);
    sent.set(key, { code, count: (sent.get(key)?.count ?? 0) + 1 });
  }
  const unreadableItemCodes = [...sent]
    .filter(([key, { count }]) => count > (kept.get(key) ?? 0))
    .map(([, { code }]) => code);
  return {
    ...fields,
    billItems,
    ...(unreadableItemCodes.length > 0 && { unreadableItemCodes }),
    // Deliberately biller-wide: a package list that isn't a list hides which
    // codes it held, so none of this biller's packages can be confirmed.
    // One bad group blocks the whole biller (fail closed); live Kuda lists
    // had no groups at all when this was written (2026-11-20).
    ...(hasMalformedItemList(rawItems) && { packagesUnreadable: true }),
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
