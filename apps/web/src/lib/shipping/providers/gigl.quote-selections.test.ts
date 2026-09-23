import { describe, expect, it, vi } from 'vitest';
import { GiglDeliveryType, PickupOptions } from './gigl.constants';
import {
  createGiglQuoteSelections,
  runGiglQuoteSelections,
} from './gigl.quote-selections';

describe('runGiglQuoteSelections', () => {
  it('builds standard and faster selections for one fulfillment mode', () => {
    expect(createGiglQuoteSelections(PickupOptions.ServiceCentre)).toEqual([
      {
        deliveryType: GiglDeliveryType.GoStandard,
        pickupOption: PickupOptions.ServiceCentre,
      },
      {
        deliveryType: GiglDeliveryType.GoFaster,
        pickupOption: PickupOptions.ServiceCentre,
      },
    ]);
  });

  it('isolates a failed provider option without discarding successful quotes', async () => {
    const log = vi.fn();
    const result = await runGiglQuoteSelections({
      selections: [
        {
          deliveryType: GiglDeliveryType.GoStandard,
          pickupOption: PickupOptions.HomeDelivery,
        },
        {
          deliveryType: GiglDeliveryType.GoFaster,
          pickupOption: PickupOptions.HomeDelivery,
        },
      ],
      signal: new AbortController().signal,
      timeoutMs: 5000,
      log,
      fetchQuote: vi
        .fn()
        .mockResolvedValueOnce({ id: 'quote' })
        .mockRejectedValueOnce(new Error('provider failure')),
    });

    expect(result).toEqual([{ id: 'quote' }, null]);
    expect(log).toHaveBeenCalledWith(
      'error',
      'GIGL quote option failed',
      expect.objectContaining({ error: 'Error: provider failure' })
    );
  });

  it('does not report intentionally cancelled pickup prefetches as timeouts', async () => {
    const parentController = new AbortController();
    const pickupController = new AbortController();
    const signal = AbortSignal.any([
      parentController.signal,
      pickupController.signal,
    ]);
    const log = vi.fn();
    const fetchQuote = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const pendingResult = runGiglQuoteSelections({
      selections: [
        {
          deliveryType: GiglDeliveryType.GoStandard,
          pickupOption: PickupOptions.ServiceCentre,
        },
      ],
      signal,
      timeoutMs: 5000,
      log,
      isExpectedAbort: () =>
        pickupController.signal.aborted && !parentController.signal.aborted,
      fetchQuote,
    });
    expect(fetchQuote).toHaveBeenCalledOnce();

    pickupController.abort();
    const result = await pendingResult;

    expect(result).toEqual([null]);
    expect(log).not.toHaveBeenCalled();
  });

  it('reports pickup work cancelled by the parent deadline as a timeout', async () => {
    const parentController = new AbortController();
    const pickupController = new AbortController();
    const signal = AbortSignal.any([
      parentController.signal,
      pickupController.signal,
    ]);
    const log = vi.fn();
    const pendingResult = runGiglQuoteSelections({
      selections: [
        {
          deliveryType: GiglDeliveryType.GoStandard,
          pickupOption: PickupOptions.ServiceCentre,
        },
      ],
      signal,
      timeoutMs: 5000,
      log,
      isExpectedAbort: () =>
        pickupController.signal.aborted && !parentController.signal.aborted,
      fetchQuote: () =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    });

    parentController.abort();
    await expect(pendingResult).resolves.toEqual([null]);
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL quote option timed out',
      expect.objectContaining({ timeoutMs: 5000 })
    );
  });
});
