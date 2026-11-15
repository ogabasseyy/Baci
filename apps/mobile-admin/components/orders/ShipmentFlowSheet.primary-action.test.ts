import { describe, expect, it, vi } from 'vitest';
import { runShipmentFlowPrimaryAction } from './ShipmentFlowSheet.primary-action';

function input(overrides: Record<string, unknown> = {}) {
  return {
    canBookGigl: true,
    canUseProvider: true,
    externalWaybill: undefined,
    giglShipping: undefined,
    isRecoveryBlocking: false,
    onConfirmSelfFulfillment: vi.fn(),
    onContinueFromDetails: vi.fn(),
    onContinueFromMethod: vi.fn(),
    onRecoveryRequired: vi.fn(),
    selectedMode: 'provider' as const,
    step: 'method' as const,
    ...overrides,
  } as Parameters<typeof runShipmentFlowPrimaryAction>[0];
}

describe('runShipmentFlowPrimaryAction', () => {
  it('books a saved non-GIG quote for staff without GIG booking rights', async () => {
    const args = input({ canBookGigl: false });
    await runShipmentFlowPrimaryAction(args);
    expect(args.onContinueFromMethod).toHaveBeenCalledTimes(1);
  });

  it('does not book when no provider quote can be used', async () => {
    const args = input({ canUseProvider: false });
    await runShipmentFlowPrimaryAction(args);
    expect(args.onContinueFromMethod).not.toHaveBeenCalled();
  });

  it('does not start a GIG wallet booking without booking rights', async () => {
    const ensure = vi.fn().mockResolvedValue(true);
    const args = input({
      canBookGigl: false,
      giglShipping: { ensureFreshQuoteForConfirmation: ensure },
    });
    await runShipmentFlowPrimaryAction(args);
    expect(ensure).not.toHaveBeenCalled();
    expect(args.onContinueFromMethod).not.toHaveBeenCalled();
  });

  it('stops when the GIG quote could not be refreshed', async () => {
    const args = input({
      giglShipping: {
        ensureFreshQuoteForConfirmation: vi.fn().mockResolvedValue(false),
      },
    });
    await runShipmentFlowPrimaryAction(args);
    expect(args.onContinueFromMethod).not.toHaveBeenCalled();
  });

  it('asks for recovery when booking needs the checkout destination reviewed', async () => {
    const args = input({
      onContinueFromMethod: vi.fn().mockResolvedValue('review_checkout_quote'),
    });
    await runShipmentFlowPrimaryAction(args);
    expect(args.onRecoveryRequired).toHaveBeenCalledTimes(1);
  });

  it('does nothing while recovery is blocking', async () => {
    const args = input({ isRecoveryBlocking: true });
    await runShipmentFlowPrimaryAction(args);
    expect(args.onContinueFromMethod).not.toHaveBeenCalled();
  });
});
