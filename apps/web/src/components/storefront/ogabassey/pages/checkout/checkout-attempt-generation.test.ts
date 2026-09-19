import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readCheckoutAttemptGeneration,
  rotateCheckoutAttemptGeneration,
} from './checkout-attempt-generation';

describe('checkout attempt generation', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('starts at zero for a fresh session', () => {
    expect(readCheckoutAttemptGeneration()).toBe(0);
  });

  it('rotates and persists across reads', () => {
    expect(rotateCheckoutAttemptGeneration()).toBe(1);
    expect(rotateCheckoutAttemptGeneration()).toBe(2);
    expect(readCheckoutAttemptGeneration()).toBe(2);
  });

  it('falls back to zero for corrupt stored values', () => {
    window.sessionStorage.setItem(
      'baci:checkout-attempt-generation',
      'not-a-number'
    );

    expect(readCheckoutAttemptGeneration()).toBe(0);
    expect(rotateCheckoutAttemptGeneration()).toBe(1);
  });

  it('survives unavailable storage without throwing', () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage'
    );
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('session storage unavailable');
      },
    });

    try {
      expect(readCheckoutAttemptGeneration()).toBe(0);
      expect(rotateCheckoutAttemptGeneration()).toBe(1);
      // The failed write must persist in memory so the next attempt keeps
      // a fresh generation instead of repeating 1.
      expect(readCheckoutAttemptGeneration()).toBe(1);
      expect(rotateCheckoutAttemptGeneration()).toBe(2);
      expect(readCheckoutAttemptGeneration()).toBe(2);
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, 'sessionStorage', storageDescriptor);
      } else {
        Reflect.deleteProperty(window, 'sessionStorage');
      }
      vi.unstubAllGlobals();
    }
  });
});
