import { describe, expect, it } from 'vitest';
import {
  formatJumiaAmount,
  getSuccessfullyNotifiedJumiaOrderIds,
} from './notifications';

describe('Jumia order notification helpers', () => {
  it('formats an order amount with the requested currency', () => {
    expect(formatJumiaAmount(12500, 'NGN')).toContain('12,500');
  });

  it('keeps an order when at least one push token succeeds', () => {
    const result = getSuccessfullyNotifiedJumiaOrderIds(
      ['order-1', 'order-2'],
      [
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: new Error('offline') },
        { status: 'rejected', reason: new Error('offline') },
        { status: 'rejected', reason: new Error('offline') },
      ],
      2
    );

    expect(result).toEqual(['order-1']);
  });
});
