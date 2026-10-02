import { describe, expect, it, vi } from 'vitest';
import { createDeliveryStartBoundary } from './push-delivery-boundary';

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
