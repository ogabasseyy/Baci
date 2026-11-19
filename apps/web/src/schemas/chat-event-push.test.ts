import { describe, expect, it } from 'vitest';
import { chatEventPushTokenRowsSchema } from './chat-event-push';

describe('chatEventPushTokenRowsSchema', () => {
  it('accepts device rows and keeps their order', () => {
    const rows = [
      { token: 'ExponentPushToken[a]', platform: 'ios' },
      { token: 'ExponentPushToken[b]', platform: 'android' },
    ];
    expect(chatEventPushTokenRowsSchema.parse(rows)).toEqual(rows);
  });

  it('treats a null or missing result as no devices', () => {
    expect(chatEventPushTokenRowsSchema.parse(null)).toEqual([]);
    expect(chatEventPushTokenRowsSchema.parse(undefined)).toEqual([]);
    expect(chatEventPushTokenRowsSchema.parse([])).toEqual([]);
  });

  it.each([
    ['a non-array', { token: 'x', platform: 'ios' }],
    ['a row without a token', [{ platform: 'ios' }]],
    ['an empty token', [{ token: '', platform: 'ios' }]],
    ['a row without a platform', [{ token: 'ExponentPushToken[a]' }]],
    ['a non-string token', [{ token: 7, platform: 'ios' }]],
    ['a null row', [null]],
  ])('rejects %s', (_label, value) => {
    expect(chatEventPushTokenRowsSchema.safeParse(value).success).toBe(false);
  });
});
