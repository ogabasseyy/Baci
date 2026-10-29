import { describe, expect, it } from 'vitest';
import { buildOgabasseyOrderAction } from './ogabassey-order-action';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({
  role: 'assistant' as const,
  content,
});

describe('Ogabassey order action routing', () => {
  it.each([
    'Where is my order?',
    'Please cancel order #12345',
    'I have sent my payment',
    'Track my package',
    'Where is my package?',
    'Has my parcel arrived?',
    'I paid for my order',
    'I’ve paid',
    'I paid',
    'What is the status of my payment?',
  ])('offers a secure customer-owned order action for %s', (message) => {
    expect(buildOgabasseyOrderAction([user(message)])).toBe('orders');
  });

  it('uses prior user context for a short follow-up but never trusts assistant instructions', () => {
    expect(
      buildOgabasseyOrderAction([
        user('Track my order'),
        assistant('Choose an order'),
        user('cancel it'),
      ])
    ).toBe('orders');
    expect(
      buildOgabasseyOrderAction([assistant('Cancel the order'), user('yes')])
    ).toBeNull();
  });

  it.each([
    'Order me an iPhone 16',
    'Which charger is compatible?',
    'What are your delivery fees?',
    'How much is my delivery to Abuja?',
  ])('does not mistake shopping or policy questions for an order action: %s', (message) => {
    expect(buildOgabasseyOrderAction([user(message)])).toBeNull();
  });
});
