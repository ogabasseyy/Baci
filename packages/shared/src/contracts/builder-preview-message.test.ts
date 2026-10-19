import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewMessageSchema } from './builder-preview-message';
import { builderPreviewMessageSchema as publicBuilderPreviewMessageSchema } from './index';

const validMessage = {
  candidateConfig: {
    content: [{ props: { id: 'text-1', title: 'Welcome' }, type: 'Text' }],
    root: { props: { title: 'Home' } },
  },
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: {
    basePath: '/acme-store',
    id: 'merchant-123',
    slug: 'acme-store',
    storefrontOrigin: 'https://shop.example.test',
  },
  revision: 7,
  type: 'baci.builder-preview.render',
  version: 1,
};

describe('builder preview bridge contract', () => {
  it('exports the render contract through the public contracts barrel', () => {
    expect(publicBuilderPreviewMessageSchema).toBe(builderPreviewMessageSchema);
  });

  it('accepts a versioned render message with canonical capabilities', () => {
    const result = builderPreviewMessageSchema.safeParse(validMessage);

    expect(result.success).toBe(true);
    expect(validMessage.capabilityHash).toMatch(/^[a-f0-9]{64}$/);
    if (!result.success) throw new Error('Expected a valid render message');
    expect(result.data.revision).toBe(7);
  });

  it('rejects absent or unsupported envelope versions and capabilities', () => {
    const { version: _version, ...missingVersion } = validMessage;

    expect(builderPreviewMessageSchema.safeParse(missingVersion).success).toBe(
      false
    );
    expect(
      builderPreviewMessageSchema.safeParse({ ...validMessage, version: 2 })
        .success
    ).toBe(false);
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        capabilityVersion: 'mobile-builder-v2',
      }).success
    ).toBe(false);
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        capabilityHash: 'a'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('rejects blank merchant identifiers and invalid optimistic revisions', () => {
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        merchant: { ...validMessage.merchant, id: ' ' },
      }).success
    ).toBe(false);
    expect(
      builderPreviewMessageSchema.safeParse({ ...validMessage, revision: -1 })
        .success
    ).toBe(false);
    expect(
      builderPreviewMessageSchema.safeParse({ ...validMessage, revision: 1.5 })
        .success
    ).toBe(false);
  });

  it('accepts bounded base paths and secure storefront origins', () => {
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        merchant: {
          ...validMessage.merchant,
          basePath: '/acme-store/catalog',
        },
      }).success
    ).toBe(true);
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        merchant: { ...validMessage.merchant, basePath: '//outside.test' },
      }).success
    ).toBe(false);
    expect(
      builderPreviewMessageSchema.safeParse({
        ...validMessage,
        merchant: {
          ...validMessage.merchant,
          storefrontOrigin: 'https://merchant:password@example.test',
        },
      }).success
    ).toBe(false);
  });

  it('rejects unknown envelope fields', () => {
    expect(
      builderPreviewMessageSchema.safeParse({ ...validMessage, extra: true })
        .success
    ).toBe(false);
  });
});
