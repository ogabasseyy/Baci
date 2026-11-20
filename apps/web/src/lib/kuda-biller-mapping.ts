import type { Biller } from './kuda';
import { mapKudaBillItems } from './kuda-bill-items';
import { collectRawFixedPricesKobo } from './kuda-raw-fixed-prices';
import { collectUnreadableFixedItemCodes } from './kuda-unreadable-item-codes';

/** A biller as Kuda returns it (camelCase in production). */
export interface KudaCamelBiller {
  id: string;
  name: string;
  description: string;
  billerIconUrl?: string;
  billTypeId: string;
  billItems?: unknown[];
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
  BillItems?: unknown[];
}

function toBiller(
  fields: Omit<Biller, 'billItems' | 'unreadableItemCodes'>,
  rawItems: unknown
): Biller {
  const unreadableItemCodes = collectUnreadableFixedItemCodes(rawItems);
  return {
    ...fields,
    billItems: mapKudaBillItems(rawItems),
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
