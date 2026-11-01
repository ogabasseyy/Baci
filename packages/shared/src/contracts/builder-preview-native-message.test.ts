import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewMessageSchema } from './builder-preview-message';
import {
  builderNativePreviewInitSchema,
  builderNativePreviewRenderSchema,
  builderNativePreviewResponseSchema,
} from './builder-preview-native-message';

const nonce = 'a'.repeat(32);
const render = {
  candidateConfig: { content: [], root: { props: { title: 'Home' } } },
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: { id: 'merchant-123', slug: 'acme-store' },
  revision: 7,
  sessionNonce: nonce,
  type: 'baci.builder-preview.native-render',
  version: 2,
};

describe('native builder preview envelopes', () => {
  it('accepts only inert placeholders for known refused components', () => {
    const placeholder = (props: Record<string, unknown>) => ({
      ...render,
      candidateConfig: {
        ...render.candidateConfig,
        content: [{ type: 'PreviewPlaceholder', props }],
      },
    });
    expect(
      builderNativePreviewRenderSchema.safeParse(
        placeholder({ id: 'code-1', label: 'CodeEmbed section' })
      ).success
    ).toBe(true);
    expect(
      builderNativePreviewRenderSchema.safeParse(
        placeholder({ id: 'code-1', label: 'Text section' })
      ).success
    ).toBe(false);
    expect(
      builderNativePreviewRenderSchema.safeParse(
        placeholder({
          id: 'code-1',
          label: 'CodeEmbed section',
          code: '<script />',
        })
      ).success
    ).toBe(false);
  });
  it('requires a bounded session nonce for init, render and responses', () => {
    expect(
      builderNativePreviewInitSchema.safeParse({
        type: 'baci.builder-preview.native-init',
        version: 2,
        sessionNonce: nonce,
      }).success
    ).toBe(true);
    expect(builderNativePreviewRenderSchema.safeParse(render).success).toBe(
      true
    );
    expect(
      builderNativePreviewResponseSchema.safeParse({
        type: 'baci.builder-preview.native-rendered',
        version: 2,
        sessionNonce: nonce,
        revision: 7,
      }).success
    ).toBe(true);
    for (const bad of ['', 'x'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) {
      expect(
        builderNativePreviewRenderSchema.safeParse({
          ...render,
          sessionNonce: bad,
        }).success
      ).toBe(false);
      expect(
        builderNativePreviewResponseSchema.safeParse({
          type: 'baci.builder-preview.native-ready',
          version: 2,
          sessionNonce: bad,
        }).success
      ).toBe(false);
    }
  });
  it('keeps the existing web protocol distinct and unchanged', () => {
    const { sessionNonce: _nonce, ...rest } = render;
    expect(
      builderPreviewMessageSchema.safeParse({
        ...rest,
        type: 'baci.builder-preview.render',
        version: 1,
      }).success
    ).toBe(true);
    expect(builderPreviewMessageSchema.safeParse(render).success).toBe(false);
    expect(
      builderNativePreviewRenderSchema.safeParse({
        ...render,
        capabilityHash: 'stale',
      }).success
    ).toBe(false);
    expect(
      builderNativePreviewRenderSchema.safeParse({ ...render, revision: -1 })
        .success
    ).toBe(false);
  });
});

it('rejects unknown fields and invalid capabilities, revisions or response codes', () => {
  expect(
    builderNativePreviewInitSchema.safeParse({
      type: 'baci.builder-preview.native-init',
      version: 2,
      sessionNonce: nonce,
      extra: true,
    }).success
  ).toBe(false);
  expect(
    builderNativePreviewRenderSchema.safeParse({ ...render, version: 1 })
      .success
  ).toBe(false);
  expect(
    builderNativePreviewRenderSchema.safeParse({
      ...render,
      revision: 2_147_483_648,
    }).success
  ).toBe(false);
  expect(
    builderNativePreviewResponseSchema.safeParse({
      type: 'baci.builder-preview.native-error',
      version: 2,
      sessionNonce: nonce,
      code: 'NOT VALID',
    }).success
  ).toBe(false);
  expect(
    builderNativePreviewResponseSchema.safeParse({
      type: 'baci.builder-preview.native-ready',
      version: 2,
      sessionNonce: nonce,
      capabilityHash: builderDesignCapabilities.capabilityHash,
      capabilityVersion: builderDesignCapabilities.capabilityVersion,
    }).success
  ).toBe(true);
});
