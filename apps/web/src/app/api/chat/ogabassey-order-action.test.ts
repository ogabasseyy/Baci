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
    'Yes',
    'Okay',
    'Go ahead',
  ])('offers the secure order panel for an affirmative follow-up: %s', (reply) => {
    expect(
      buildOgabasseyOrderAction([
        user('Please cancel my order'),
        assistant('Choose an order in your account.'),
        user(reply),
      ])
    ).toBe('orders');
  });

  it('does not use an older order request to intercept a later cart confirmation', () => {
    expect(
      buildOgabasseyOrderAction([
        user('Track my order'),
        assistant('You can view your orders.'),
        user('Show me iPhone 16'),
        assistant('Shall I add it to your cart?'),
        user('Yes'),
      ])
    ).toBeNull();
  });

  it('does not reopen order controls after an unrelated question', () => {
    expect(
      buildOgabasseyOrderAction([
        user('Track my order'),
        assistant('Are you having a good day?'),
        user('Yes'),
      ])
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
