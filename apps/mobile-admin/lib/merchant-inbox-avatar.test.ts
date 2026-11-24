import { describe, expect, it } from 'vitest';
import {
  INBOX_AVATAR_EMOJI,
  INBOX_AVATAR_TONES,
  inboxAvatar,
} from './merchant-inbox-avatar';

describe('inboxAvatar', () => {
  it('gives the same name the same face and colour every time', () => {
    expect(inboxAvatar('small-meadow-890')).toEqual(
      inboxAvatar('small-meadow-890')
    );
  });

  it('ignores case and surrounding spaces in the name', () => {
    expect(inboxAvatar('  Ada Obi ')).toEqual(inboxAvatar('ada obi'));
  });

  it('always picks a face and a colour from the fixed sets', () => {
    for (const name of ['', 'a', 'Ada Obi', 'sparkling-snow-568', '日本語']) {
      const { emoji, tone } = inboxAvatar(name);
      expect(INBOX_AVATAR_EMOJI).toContain(emoji);
      expect(INBOX_AVATAR_TONES).toContain(tone);
    }
  });

  it('spreads different visitors over several faces, not one', () => {
    const names = [
      'small-meadow-890',
      'sparkling-snow-568',
      'withered-violet-149',
      'autumn-paper-891',
      'wispy-frog-556',
      'sparkling-firefly-766',
    ];
    const faces = new Set(names.map((name) => inboxAvatar(name).emoji));
    expect(faces.size).toBeGreaterThan(2);
  });
});
