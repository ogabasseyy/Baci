// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./owner-mtls-fetch', () => ({ createOwnerMtlsFetch: () => vi.fn() }));

import { configuredOwnerPreview } from './owner-preview-web-config';

const valid = {
  enabled: true,
  key: Buffer.alloc(32, 7).toString('base64url'),
  executionOrigin: 'https://output.runtime.test',
  previewOrigin: 'https://builder.baci.test',
  ownerOrigin: 'https://builder-owner.usebaci.com',
  ownerCert: 'synthetic-cert',
  ownerKey: 'synthetic-key',
};

describe('owner preview web configuration', () => {
  it('remains disabled unless the release switch is enabled', () => {
    expect(
      configuredOwnerPreview({ ...valid, enabled: false })
    ).toBeUndefined();
  });

  it('accepts a dedicated canonical key and isolated HTTPS origins', () => {
    expect(configuredOwnerPreview(valid)).toBeTypeOf('function');
  });

  it.each([
    { key: undefined },
    { key: Buffer.alloc(31).toString('base64url') },
    { key: `${valid.key}=` },
    { executionOrigin: 'http://output.runtime.test' },
    { previewOrigin: 'https://other.runtime.test' },
    { previewOrigin: undefined },
    { ownerOrigin: undefined },
    { ownerOrigin: 'https://mcp.usebaci.com' },
    { ownerOrigin: 'https://builder-mcp.usebaci.com' },
    { ownerOrigin: 'https://other.usebaci.com' },
    { ownerOrigin: 'https://builder-owner.usebaci.com:8443' },
    { ownerOrigin: 'https://owner.baci-internal.invalid' },
    { ownerCert: undefined },
    { ownerKey: undefined },
  ])('fails closed on invalid configuration: %j', (invalid) => {
    expect(configuredOwnerPreview({ ...valid, ...invalid })).toBeUndefined();
  });
});
