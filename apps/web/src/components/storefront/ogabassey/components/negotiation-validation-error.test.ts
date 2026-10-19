import { describe, expect, it } from 'vitest';
import { NegotiationValidationError } from './negotiation-validation-error';

describe('negotiation validation error', () => {
  it('uses a typed validation error for modal request failures', () => {
    const error = new NegotiationValidationError('Invalid contact');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NegotiationValidationError');
    expect(error.message).toBe('Invalid contact');
  });
});
