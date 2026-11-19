import { describe, expect, it } from 'vitest';
import { createSimulatedOxygenCheckout } from './simulated-checkout';

describe('simulated Oxygen checkout adapter', () => {
  it('returns the observed 35% plan without treating upfront payment as an instalment', async () => {
    const adapter = createSimulatedOxygenCheckout();
    const snapshot = await adapter.load();
    expect(snapshot).toMatchObject({
      mode: 'simulation',
      phase: 'booked',
      realActivation: 'not_requested',
      settlement: 'not_verified',
      quote: {
        productMinor: 40000000,
        equityMinor: 14000000,
        principalMinor: 26000000,
        chargesMinor: 513500,
        upfrontMinor: 14513500,
        totalRepaymentMinor: 29234562,
        instalmentsMinor: [9744900, 9744900, 9744762],
      },
    });
  });
  it('checks acceptance and both completion flags before confirming the simulation', async () => {
    const adapter = createSimulatedOxygenCheckout();
    const { bookingReference: ref } = await adapter.load();
    await expect(adapter.confirmPreview(ref)).rejects.toThrow();
    await adapter.acceptOffer(ref);
    await adapter.simulateHostedCompletion(ref, 'payment');
    expect(await adapter.checkCompletion(ref)).toMatchObject({
      paymentComplete: true,
      setupComplete: false,
    });
    await expect(adapter.confirmPreview(ref)).rejects.toThrow();
    await adapter.simulateHostedCompletion(ref, 'setup');
    const result = await adapter.confirmPreview(ref);
    expect(result).toMatchObject({
      phase: 'simulation_complete',
      realActivation: 'not_requested',
      settlement: 'not_verified',
    });
  });
  it('requires acceptance before a simulated hosted payment can be completed', async () => {
    const adapter = createSimulatedOxygenCheckout();
    const { bookingReference: ref } = await adapter.load();
    await expect(
      adapter.simulateHostedCompletion(ref, 'payment')
    ).rejects.toThrow();
  });
  it('replaces a booking when terms change and rejects actions on the old reference', async () => {
    const adapter = createSimulatedOxygenCheckout();
    const old = await adapter.load();
    await adapter.acceptOffer(old.bookingReference);
    const replacement = await adapter.replaceBooking(old.bookingReference, 30);
    expect(replacement.bookingReference).not.toBe(old.bookingReference);
    expect(replacement).toMatchObject({
      phase: 'booked',
      paymentComplete: false,
      setupComplete: false,
      quote: {
        equityMinor: 12000000,
        principalMinor: 28000000,
        chargesMinor: 553000,
        upfrontMinor: 12553000,
      },
    });
    await expect(adapter.acceptOffer(old.bookingReference)).rejects.toThrow();
  });
  it('does not permit changing terms after completing payment', async () => {
    const adapter = createSimulatedOxygenCheckout();
    const { bookingReference: ref } = await adapter.load();
    await adapter.acceptOffer(ref);
    await adapter.simulateHostedCompletion(ref, 'payment');
    await expect(adapter.replaceBooking(ref, 25)).rejects.toThrow();
  });
  it('isolates sessions and snapshots so UI mutation cannot fabricate completion', async () => {
    const first = createSimulatedOxygenCheckout();
    const second = createSimulatedOxygenCheckout();
    const copy = await first.load();
    copy.paymentComplete = true;
    copy.quote.instalmentsMinor[0] = 0;
    expect(await first.load()).toMatchObject({
      paymentComplete: false,
      quote: { instalmentsMinor: [9744900, 9744900, 9744762] },
    });
    expect(await second.load()).toMatchObject({
      phase: 'booked',
      paymentComplete: false,
    });
  });
});
