import { runInNewContext } from 'node:vm';
import {
  builderDesignCapabilities,
  builderNativePreviewRenderSchema,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildNativePreviewInitScript,
  buildNativePreviewRenderScript,
  buildNativePreviewUrl,
  isNativePreviewNavigationAllowed,
} from './native-preview-script';

const nonce = 'a'.repeat(32);
const input = {
  candidateConfig: {
    content: [],
    root: { props: { title: 'Safe\u2028title' } },
  },
  merchant: { id: 'merchant-1', slug: 'acme' },
  revision: 1,
  sessionNonce: nonce,
};

describe('native preview transport', () => {
  it('pins the preview route to an explicit HTTPS origin', () => {
    expect(
      buildNativePreviewUrl('https://usebaci.com/anything?ignored=1')
    ).toBe('https://usebaci.com/template-preview/builder-preview?native=2');
    expect(buildNativePreviewUrl('https://name:pass@usebaci.com')).toBeNull();
    expect(buildNativePreviewUrl('http://example.com')).toBeNull();
    expect(buildNativePreviewUrl('javascript:alert(1)')).toBeNull();
  });
  it('validates before generating a data-only script', () => {
    const script = buildNativePreviewRenderScript(input);
    expect(script).toContain('baci.builder-preview.native-render');
    expect(script).toContain(builderDesignCapabilities.capabilityHash);
    expect(script).not.toContain('\u2028');
    expect(
      buildNativePreviewRenderScript({ ...input, sessionNonce: 'bad' })
    ).toBeNull();
    expect(
      buildNativePreviewRenderScript({
        ...input,
        merchant: { id: 'x', slug: 'bad/slug' },
      })
    ).toBeNull();
    expect(buildNativePreviewInitScript(nonce)).toContain(
      'baci.builder-preview.native-init'
    );
    expect(buildNativePreviewInitScript('bad')).toBeNull();
  });
});

it('accepts navigation only to the pinned preview document', () => {
  const expected =
    'https://usebaci.com/template-preview/builder-preview?native=2';
  expect(isNativePreviewNavigationAllowed(expected, expected)).toBe(true);
  for (const url of [
    'https://evil.example/template-preview/builder-preview',
    'https://usebaci.com/other',
    'https://usebaci.com/template-preview/builder-preview?x=1',
    'https://user@usebaci.com/template-preview/builder-preview',
    'javascript:alert(1)',
  ]) {
    expect(isNativePreviewNavigationAllowed(url, expected)).toBe(false);
  }
});

it('rejects a matching URL outside the isolated preview route', () => {
  const wrong = 'https://usebaci.com/checkout';
  expect(isNativePreviewNavigationAllowed(wrong, wrong)).toBe(false);
});

it('dispatches the validated draft as data to both native message targets', () => {
  const sent: string[] = [];
  const target = {
    dispatchEvent: (event: MessageEvent) => sent.push(event.data),
  };
  const script = buildNativePreviewRenderScript(input);
  expect(script).not.toBeNull();
  runInNewContext(script as string, {
    window: target,
    document: target,
    MessageEvent,
  });
  expect(sent).toHaveLength(2);
  for (const data of sent) {
    const parsed = builderNativePreviewRenderSchema.parse(JSON.parse(data));
    expect(parsed.sessionNonce).toBe(nonce);
    expect(parsed.candidateConfig.root.props).toMatchObject({
      title: 'Safe\u2028title',
    });
  }
});
