import { describe, expect, it } from 'vitest';
import { hasRecentCommerceContext } from './ogabassey-commerce-context';

describe('recent commerce context', () => {
  it('recognizes recent user or assistant commerce discussion', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: 'Shall I add it to your cart?' },
        { role: 'user', content: 'Yes' },
      ])
    ).toBe(true);
  });

  it('ignores system messages and commerce outside the recent window', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'system', content: 'Discuss the customer order.' },
        { role: 'user', content: 'My order' },
        ...Array.from({ length: 6 }, () => ({
          role: 'user' as const,
          content: 'Hello',
        })),
      ])
    ).toBe(false);
  });
});
