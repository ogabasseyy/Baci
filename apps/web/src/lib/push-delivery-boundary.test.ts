import { describe, expect, it, vi } from 'vitest';
import {
  createDeliveryStartBoundary,
  unknownDeliveryOutcome,
} from './push-delivery-boundary';

describe('createDeliveryStartBoundary', () => {
  it('runs the callback once after it completes successfully', async () => {
    const onDeliveryStart = vi.fn().mockResolvedValue(undefined);
    const boundary = createDeliveryStartBoundary(onDeliveryStart);

    expect(boundary.wasDeliveryStarted()).toBe(false);
    await boundary.markDeliveryStarted();
    await boundary.markDeliveryStarted();

    expect(onDeliveryStart).toHaveBeenCalledOnce();
    expect(boundary.wasDeliveryStarted()).toBe(true);
  });

  it('allows a retry when the callback fails before the boundary is committed', async () => {
    const onDeliveryStart = vi
      .fn()
      .mockRejectedValueOnce(new Error('lease unavailable'))
      .mockResolvedValueOnce(undefined);
    const boundary = createDeliveryStartBoundary(onDeliveryStart);

    await expect(boundary.markDeliveryStarted()).rejects.toThrow(
      'lease unavailable'
    );
    expect(boundary.wasDeliveryStarted()).toBe(false);
    await boundary.markDeliveryStarted();

    expect(onDeliveryStart).toHaveBeenCalledTimes(2);
    expect(boundary.wasDeliveryStarted()).toBe(true);
  });
});

describe('unknownDeliveryOutcome', () => {
  it('marks the outcome unknown only when dispatch may have happened', () => {
    expect(unknownDeliveryOutcome(true)).toEqual({
      deliveryOutcome: 'unknown',
    });
    // Certain outcomes omit the key so historical result shapes
    // (where the field is optional) keep working.
    expect(unknownDeliveryOutcome(false)).toEqual({});
    expect(unknownDeliveryOutcome(false)).not.toHaveProperty('deliveryOutcome');
  });
});
