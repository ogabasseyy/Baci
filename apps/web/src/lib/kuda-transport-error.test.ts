import { describe, expect, it } from 'vitest';
import {
  isKudaOutcomeUnknown,
  KudaApiHttpError,
} from './kuda-transport-error';

describe('isKudaOutcomeUnknown', () => {
  it('treats only definitive 4xx rejections as known failures', () => {
    expect(isKudaOutcomeUnknown(new KudaApiHttpError(400, 'Bad Request'))).toBe(
      false
    );
    expect(isKudaOutcomeUnknown(new KudaApiHttpError(404, 'Not Found'))).toBe(
      false
    );
  });

  it('treats 5xx responses as unknown (the vend may have landed)', () => {
    expect(
      isKudaOutcomeUnknown(new KudaApiHttpError(500, 'Internal Server Error'))
    ).toBe(true);
    expect(
      isKudaOutcomeUnknown(new KudaApiHttpError(503, 'Service Unavailable'))
    ).toBe(true);
  });

  it('treats timeouts, drops, and malformed bodies as unknown', () => {
    expect(
      isKudaOutcomeUnknown(
        new Error('Kuda ADMIN_PURCHASE_BILL request timed out')
      )
    ).toBe(true);
    // DOMException aborts skip kudaRequest's instanceof Error
    // conversion, so match by name like the request layer does.
    expect(
      isKudaOutcomeUnknown(new DOMException('Aborted', 'AbortError'))
    ).toBe(true);
    expect(isKudaOutcomeUnknown(new TypeError('fetch failed'))).toBe(true);
    expect(
      isKudaOutcomeUnknown(new SyntaxError('Unexpected token in JSON'))
    ).toBe(true);
  });

  it('fails closed to unknown for anything else thrown post-attempt', () => {
    // A parser bug after a landed vend must requery, never refund:
    // stuck-pending is visible, a wrongful refund is silent loss.
    expect(isKudaOutcomeUnknown(new RangeError('bad index'))).toBe(true);
    expect(isKudaOutcomeUnknown('string throw')).toBe(true);
    expect(isKudaOutcomeUnknown(null)).toBe(true);
  });
});
