import { describe, expect, it, vi } from 'vitest';

const span = { setAttribute: vi.fn() };
vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: vi.fn(() => span) },
}));

import { annotateMerchantTrace } from './merchant-tracing';

describe('merchant trace annotation', () => {
  it('adds slug and optional domain only when a trace span is active', () => {
    annotateMerchantTrace('ogabassey', 'ogabassey.com');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'merchant.slug',
      'ogabassey'
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'merchant.domain',
      'ogabassey.com'
    );
  });
});
