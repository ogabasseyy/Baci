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
          return null;
        }
        options.log('error', 'GIGL quote option failed', {
          error: String(error),
          ...selection,
        });
        return null;
      })
    )
  );
}
