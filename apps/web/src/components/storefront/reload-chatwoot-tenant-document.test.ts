// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { reloadChatwootTenantDocument } from './reload-chatwoot-tenant-document';

describe('reloadChatwootTenantDocument', () => {
  it('reloads the current browser document', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });

    reloadChatwootTenantDocument();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
