import {
  builderDesignCapabilities,
  builderNativePreviewInitSchema,
  builderNativePreviewRenderSchema,
  MAX_AI_EDIT_BODY_BYTES,
} from '@baci/shared/contracts';

interface NativePreviewRenderInput {
  candidateConfig: unknown;
  merchant: {
    id: string;
    slug: string;
    basePath?: string;
    storefrontOrigin?: string;
  };
  revision: number;
  sessionNonce: string;
}

export function buildNativePreviewUrl(base: string): string | null {
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      return null;
    return new URL(
      '/template-preview/builder-preview?native=2',
      parsed.origin
    ).toString();
  } catch {
    return null;
  }
}

function createDispatchScript(value: unknown): string | null {
  const data = JSON.stringify(value);
  if (new TextEncoder().encode(data).byteLength > MAX_AI_EDIT_BODY_BYTES)
    return null;
  const literal = JSON.stringify(data)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `(function(){var data=${literal};var send=function(target){target.dispatchEvent(new MessageEvent('message',{data:data}));};send(window);send(document);})();true;`;
}

export function buildNativePreviewInitScript(
  sessionNonce: string,
  previousSessionNonce?: string
): string | null {
  const parsed = builderNativePreviewInitSchema.safeParse({
    type: 'baci.builder-preview.native-init',
    version: 2,
    sessionNonce,
    ...(previousSessionNonce ? { previousSessionNonce } : {}),
  });
  return parsed.success ? createDispatchScript(parsed.data) : null;
}

export function buildNativePreviewRenderScript(
  input: NativePreviewRenderInput
): string | null {
  const parsed = builderNativePreviewRenderSchema.safeParse({
    ...input,
    type: 'baci.builder-preview.native-render',
    version: 2,
    capabilityHash: builderDesignCapabilities.capabilityHash,
    capabilityVersion: builderDesignCapabilities.capabilityVersion,
  });
  return parsed.success ? createDispatchScript(parsed.data) : null;
}

export function isNativePreviewNavigationAllowed(
  url: string,
  expected: string
): boolean {
  try {
    const requested = new URL(url);
    const target = new URL(expected);
    return (
      target.protocol === 'https:' &&
      !target.username &&
      !target.password &&
      target.search === '?native=2' &&
      !target.hash &&
      target.pathname === '/template-preview/builder-preview' &&
      requested.protocol === 'https:' &&
      !requested.username &&
      !requested.password &&
      requested.search === target.search &&
      !requested.hash &&
      requested.origin === target.origin &&
      requested.pathname === target.pathname
    );
  } catch {
    return false;
  }
}
