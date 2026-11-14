import { describe, expect, it } from 'vitest';
import { isImeComposing } from './is-ime-composing';

describe('isImeComposing', () => {
  it('is false for a plain Enter keydown', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('is true while a DOM event reports an active composition', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('is true for the Safari confirming Enter (keyCode 229, not composing)', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('reads the native event of a React keyboard event', () => {
    expect(
      isImeComposing({
        keyCode: 13,
        nativeEvent: { isComposing: true, keyCode: 13 },
      })
    ).toBe(true);
    expect(
      isImeComposing({
        keyCode: 229,
        nativeEvent: { isComposing: false, keyCode: 229 },
      })
    ).toBe(true);
    expect(
      isImeComposing({
        keyCode: 13,
        nativeEvent: { isComposing: false, keyCode: 13 },
      })
    ).toBe(false);
  });

  it("is true when the key is reported as 'Process'", () => {
    expect(isImeComposing({ isComposing: false, key: 'Process' })).toBe(true);
    expect(
      isImeComposing({
        key: 'Process',
        nativeEvent: { isComposing: false, key: 'Process' },
      })
    ).toBe(true);
  });
});
