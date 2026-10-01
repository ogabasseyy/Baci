import { describe, expect, it } from 'vitest';
import { JumiaApiError } from './jumia-api-error';

describe('JumiaApiError', () => {
  it('includes the status code in the error name and message', () => {
    const error = new JumiaApiError(401, 'Unauthorized');

    expect(error.name).toBe('JumiaApiError');
    expect(error.status).toBe(401);
    expect(error.message).toBe('Jumia API Error (401): Unauthorized');
  });
});
