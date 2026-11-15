import { describe, expect, it } from 'vitest';
import {
  formatInboxTime,
  inboxPreview,
  previewPrefix,
  senderLabel,
} from './inbox-format';

describe('formatInboxTime', () => {
  const now = new Date('2026-11-15T18:00:00');

  it('shows the time for today and the day otherwise', () => {
    expect(formatInboxTime('2026-11-15T09:05:00', now)).toMatch(/9:05/);
    expect(formatInboxTime('2026-11-12T09:05:00', now)).toMatch(/12 Nov/);
  });

  it.each([null, '', 'not-a-date'])('is empty for %s', (value) => {
    expect(formatInboxTime(value, now)).toBe('');
  });
});

describe('sender wording', () => {
  it('labels each sender', () => {
    expect(senderLabel('customer')).toBe('Customer');
    expect(senderLabel('store')).toBe('You');
    expect(senderLabel('assistant')).toBe('Assistant');
    expect(senderLabel('system')).toBe('Automatic message');
  });

  it('prefixes only store and assistant previews', () => {
    expect(previewPrefix('store')).toBe('You: ');
    expect(previewPrefix('assistant')).toBe('Assistant: ');
    expect(previewPrefix('customer')).toBe('');
  });
});

describe('inboxPreview', () => {
  it('keeps a short message on one line with its prefix', () => {
    expect(inboxPreview({ sender: 'store', text: 'Yes,\nwe  deliver.' })).toBe(
      'You: Yes, we deliver.'
    );
  });

  it('shortens long text', () => {
    const preview = inboxPreview({ sender: 'customer', text: 'a'.repeat(500) });
    expect(preview).toBe(`${'a'.repeat(120)}…`);
  });
});
