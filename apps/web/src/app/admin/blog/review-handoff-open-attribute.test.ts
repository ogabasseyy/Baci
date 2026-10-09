import { describe, expect, it } from 'vitest';
import { hasOpenAttribute } from './review-handoff-open-attribute';

describe('hasOpenAttribute', () => {
  it.each([
    '<dialog open>',
    '<dialog open="">',
    '<dialog open="open">',
    '<dialog open="false">',
    '<DETAILS OPEN>',
    '<dialog class="x" open id="y">',
  ])('detects presence in %s', (tag) => {
    expect(hasOpenAttribute(tag)).toBe(true);
  });

  it.each([
    '<dialog>',
    '<dialog data-open>',
    '<dialog open-modal>',
    '<dialog title="open sesame">',
    '<dialog title="open">',
  ])('rejects %s', (tag) => {
    expect(hasOpenAttribute(tag)).toBe(false);
  });
});
