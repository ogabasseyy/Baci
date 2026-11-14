import { describe, expect, it } from 'vitest';
import { activateProtectionMessage } from './expo-push-messages';

describe('activateProtectionMessage', () => {
  it('names the order and carries the insurance activation payload', () => {
    expect(activateProtectionMessage('o1', 'A-1')).toEqual({
      body: expect.stringContaining('#A-1'),
      data: { orderId: 'o1', orderNumber: 'A-1', type: 'insurance_activation' },
      title: expect.stringContaining('Activate'),
    });
  });
});
