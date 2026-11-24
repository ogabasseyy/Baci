import { describe, expect, it } from 'vitest';
import { chatFollowUpEventKey } from './chat-follow-up-event-key';

describe('chatFollowUpEventKey', () => {
  it('matches the key the database gives the reminder event', () => {
    expect(chatFollowUpEventKey('5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f')).toBe(
      'fu-5f2d3c1e8a474b699c0e1a2b3c4d5e6f'
    );
  });

  it.each([
    '',
    'not-a-uuid',
    '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f-extra',
  ])('refuses %j instead of building a plausible key', (id) => {
    expect(() => chatFollowUpEventKey(id)).toThrow();
  });

  it('fits the event key pattern the database enforces', () => {
    expect(
      chatFollowUpEventKey('5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f')
    ).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
  });
});
