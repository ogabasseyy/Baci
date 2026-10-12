import { describe, expect, it } from 'vitest';
import { GATEWAY_DOCS_HTML } from './docs-page';

describe('public gateway documentation', () => {
  it('documents the read-only tools, bearer key handling, and grant limits', () => {
    expect(GATEWAY_DOCS_HTML).toContain('/openapi.json');
    expect(GATEWAY_DOCS_HTML).toContain('Authorization: Bearer');
    for (const tool of [
      'orders.list',
      'orders.get',
      'inventory.levels',
      'analytics.summary',
    ]) {
      expect(GATEWAY_DOCS_HTML).toContain(tool);
    }
    expect(GATEWAY_DOCS_HTML).toContain('All operations are read-only');
    expect(GATEWAY_DOCS_HTML).toContain('cannot expand it');
    expect(GATEWAY_DOCS_HTML).not.toContain('/v0/issue-token');
    expect(GATEWAY_DOCS_HTML).not.toContain('/v0/refresh');
    expect(GATEWAY_DOCS_HTML).not.toContain('/v0/revoke');
  });
});
