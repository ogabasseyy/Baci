import type { ShippingQuote } from '../types';
import {
  GiglDeliveryType,
  type GiglQuoteIo,
  isGiglAbortError,
  type PickupOptions,
} from './gigl.constants';

export interface GiglQuoteSelection {
  deliveryType: GiglDeliveryType;
  pickupOption: PickupOptions;
}

export function createGiglQuoteSelections(
  pickupOption: PickupOptions
): GiglQuoteSelection[] {
  return [GiglDeliveryType.GoStandard, GiglDeliveryType.GoFaster].map(
    (deliveryType) => ({ deliveryType, pickupOption })
  );
}

interface RunGiglQuoteSelectionsOptions {
  selections: GiglQuoteSelection[];
  signal: AbortSignal;
  timeoutMs: number;
  log: GiglQuoteIo['log'];
  isExpectedAbort?: () => boolean;
  fetchQuote: (selection: GiglQuoteSelection) => Promise<ShippingQuote | null>;
}

export function runGiglQuoteSelections(
  options: RunGiglQuoteSelectionsOptions
): Promise<(ShippingQuote | null)[]> {
  const failures: unknown[] = [];
  return Promise.all(
    options.selections.map((selection) =>
      options.fetchQuote(selection).catch((error) => {
        if (options.isExpectedAbort?.()) {
          return null;
        }
        if (options.signal.aborted || isGiglAbortError(error)) {
          options.log('warn', 'GIGL quote option timed out', {
            timeoutMs: options.timeoutMs,
            ...selection,
          });
          if (!options.signal.aborted) {
            // The fetch timed out while the parent still wants results: an
            // actual provider timeout, not a superseded request. Count it so
            // an all-timed-out run rejects instead of resolving unmarked.
            failures.push(
              new Error(
                `GIGL quote request timed out after ${options.timeoutMs}ms`
              )
            );
          }
          return null;
        }
        failures.push(error);
        options.log('error', 'GIGL quote option failed', {
          error: String(error),
          ...selection,
        });
        return null;
      })
    )
  ).then((quotes) => {
    if (failures.length === options.selections.length) {
      throw failures[0];
    }
    return quotes;
  });
}
