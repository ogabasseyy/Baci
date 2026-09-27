import { describe, expect, it } from 'vitest';
import { jumiaMobileTicketSchema } from './mobile-ticket';

describe('jumiaMobileTicketSchema', () => {
  it('accepts a UUID ticket', () => {
    expect(
      jumiaMobileTicketSchema.safeParse('123e4567-e89b-12d3-a456-426614174000')
        .success
    ).toBe(true);
  });

  it('rejects malformed tickets', () => {
    expect(jumiaMobileTicketSchema.safeParse('not-a-ticket').success).toBe(
      false
    );
  });
});
