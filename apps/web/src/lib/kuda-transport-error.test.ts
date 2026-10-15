import { describe, expect, it } from 'vitest';
import {
  isKudaOutcomeUnknown,
  KudaApiHttpError,
  KudaPreDispatchError,
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

  it('treats pre-dispatch auth failures as known (nothing was sent)', () => {
    // Codex R103 P1: GetToken threw before any provider request was
    // dispatched — no vend could have landed, so fail/refund instead
    // of stranding the row in processing with a never-submitted ref.
    expect(
      isKudaOutcomeUnknown(
        new KudaPreDispatchError('Kuda authentication request timed out')
      )
    ).toBe(false);
    expect(
      isKudaOutcomeUnknown(
        new KudaPreDispatchError('Failed to get Kuda token: Bad Gateway')
      )
    ).toBe(false);
  });

  it('treats HTTP 408 as ambiguous while other 4xx fail fast', () => {
    // Codex R107 P1: a 408 means the dispatched body may have
    // reached Kuda — reconcile, never refund-on-deliver.
    expect(
      isKudaOutcomeUnknown(new KudaApiHttpError(408, 'Request Timeout'))
    ).toBe(true);
    expect(isKudaOutcomeUnknown(new KudaApiHttpError(400, 'Bad Request'))).toBe(
      false
    );
    expect(isKudaOutcomeUnknown(new KudaApiHttpError(404, 'Not Found'))).toBe(
      false
    );
  });

  it('fails closed to unknown for anything else thrown post-attempt', () => {
    // A parser bug after a landed vend must requery, never refund:
    // stuck-pending is visible, a wrongful refund is silent loss.
    expect(isKudaOutcomeUnknown(new RangeError('bad index'))).toBe(true);
    expect(isKudaOutcomeUnknown('string throw')).toBe(true);
    expect(isKudaOutcomeUnknown(null)).toBe(true);
  });
});
