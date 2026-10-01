'use client';

import {
  type BuilderPreviewResponse,
  builderDesignCapabilities,
  builderPreviewResponseSchema,
} from '@baci/shared/contracts';
import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { RenderBuilderConfig } from '@/components/storefront/render-builder-config';
import { isBuilderPreviewRenderEvent } from './is-builder-preview-render-event';
import { parseBuilderPreviewEvent } from './parse-builder-preview-event';

type PreviewState = {
  config: Parameters<typeof RenderBuilderConfig>[0]['config'];
  merchantContext: Parameters<typeof RenderBuilderConfig>[0]['merchantContext'];
  revision: number;
};

type NativePreviewBridge = {
  postMessage: (message: string) => void;
};

function getBoundedEventRevision(event: Event): number | undefined {
  if (!('data' in event)) return undefined;
  const raw =
    typeof event.data === 'string'
      ? (() => {
          try {
            return JSON.parse(event.data) as unknown;
          } catch {
            return null;
          }
        })()
      : event.data;
  if (typeof raw !== 'object' || raw === null || !('revision' in raw))
    return undefined;
  const revision = raw.revision;
  return typeof revision === 'number' &&
    Number.isInteger(revision) &&
    revision >= 0 &&
    revision <= 2_147_483_647
    ? revision
    : undefined;
}

class PreviewRenderFailureBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? (
      <div role="alert">Preview unavailable.</div>
    ) : (
      this.props.children
    );
  }
}

function postPreviewResponse(response: BuilderPreviewResponse): void {
  const parsed = builderPreviewResponseSchema.safeParse(response);
  if (!parsed.success) return;
  const message = JSON.stringify(parsed.data);
  const nativeBridge = (
    window as Window & {
      ReactNativeWebView?: NativePreviewBridge;
    }
  ).ReactNativeWebView;
  nativeBridge?.postMessage(message);
  if (window.parent !== window) window.parent.postMessage(message, '*');
}

export function BuilderPreviewCanvas() {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const responseKey = useRef<string | null>(null);

  useEffect(() => {
    postPreviewResponse({
      capabilityHash: builderDesignCapabilities.capabilityHash,
      capabilityVersion: builderDesignCapabilities.capabilityVersion,
      type: 'baci.builder-preview.ready',
      version: 1,
    });

    const receivePreview = (event: Event) => {
      if (!isBuilderPreviewRenderEvent(event)) return;
      const message = parseBuilderPreviewEvent(event);
      if (!message) {
        const revision = getBoundedEventRevision(event);
        postPreviewResponse({
          code: 'invalid_message',
          ...(revision === undefined ? {} : { revision }),
          type: 'baci.builder-preview.error',
          version: 1,
        });
        return;
      }
      setPreview((current) => {
        if (current && message.revision <= current.revision) return current;
        return {
          config: message.candidateConfig,
          merchantContext: {
            basePath: message.merchant.basePath ?? `/${message.merchant.slug}`,
            id: message.merchant.id,
            slug: message.merchant.slug,
          },
          revision: message.revision,
        };
      });
    };

    window.addEventListener('message', receivePreview);
    document.addEventListener('message', receivePreview);
    return () => {
      window.removeEventListener('message', receivePreview);
      document.removeEventListener('message', receivePreview);
    };
  }, []);

  if (!preview) return null;
  const postRenderResult = (type: 'rendered' | 'error') => {
    const nextKey = `${preview.revision}:${type}`;
    if (responseKey.current === nextKey) return;
    responseKey.current = nextKey;
    postPreviewResponse(
      type === 'rendered'
        ? {
            revision: preview.revision,
            type: 'baci.builder-preview.rendered',
            version: 1,
          }
        : {
            code: 'render_failed',
            revision: preview.revision,
            type: 'baci.builder-preview.error',
            version: 1,
          }
    );
  };
  return (
    <PreviewRenderFailureBoundary
      key={preview.revision}
      onError={() => postRenderResult('error')}
    >
      <RenderBuilderConfig
        config={preview.config}
        merchantContext={preview.merchantContext}
        onRendered={() => postRenderResult('rendered')}
      />
    </PreviewRenderFailureBoundary>
  );
}
