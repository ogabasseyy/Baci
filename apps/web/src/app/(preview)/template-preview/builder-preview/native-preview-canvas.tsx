'use client';

import {
  type BuilderNativePreviewRender,
  type BuilderNativePreviewResponse,
  builderDesignCapabilities,
  builderNativePreviewResponseSchema,
} from '@baci/shared/contracts';
import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { RenderBuilderConfig } from '@/components/storefront/render-builder-config';
import { createNativePreviewSession } from './native-preview-session';

type NativeBridge = { postMessage: (message: string) => void };
function getNativeBridge(): NativeBridge | undefined {
  return (window as Window & { ReactNativeWebView?: NativeBridge })
    .ReactNativeWebView;
}
function postNative(response: BuilderNativePreviewResponse) {
  const parsed = builderNativePreviewResponseSchema.safeParse(response);
  if (parsed.success)
    getNativeBridge()?.postMessage(JSON.stringify(parsed.data));
}

class CandidateBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function NativePreviewCanvas() {
  const currentCandidate = useRef<BuilderNativePreviewRender | null>(null);
  const [committed, setCommitted] = useState<BuilderNativePreviewRender | null>(
    null
  );
  const [candidate, setCandidate] = useState<BuilderNativePreviewRender | null>(
    null
  );

  useEffect(() => {
    const session = createNativePreviewSession();
    const receive = (event: Event) => {
      if (!getNativeBridge() || window.parent !== window || !('data' in event))
        return;
      if ('source' in event && event.source !== null) return;
      const accepted = session.accept(event.data);
      if (!accepted) return;
      if (accepted.kind === 'ready') {
        if (accepted.rotated) {
          currentCandidate.current = null;
          setCandidate(null);
        }
        postNative({
          type: 'baci.builder-preview.native-ready',
          version: 2,
          sessionNonce: accepted.sessionNonce,
          capabilityHash: builderDesignCapabilities.capabilityHash,
          capabilityVersion: builderDesignCapabilities.capabilityVersion,
        });
        return;
      }
      currentCandidate.current = accepted.message;
      setCandidate(accepted.message);
    };
    window.addEventListener('message', receive);
    document.addEventListener('message', receive);
    return () => {
      currentCandidate.current = null;
      window.removeEventListener('message', receive);
      document.removeEventListener('message', receive);
    };
  }, []);

  const complete = (entry: BuilderNativePreviewRender, success: boolean) => {
    if (currentCandidate.current !== entry) return;
    currentCandidate.current = null;
    if (success) setCommitted(entry);
    setCandidate(null);
    postNative(
      success
        ? {
            type: 'baci.builder-preview.native-rendered',
            version: 2,
            sessionNonce: entry.sessionNonce,
            revision: entry.revision,
          }
        : {
            type: 'baci.builder-preview.native-error',
            version: 2,
            sessionNonce: entry.sessionNonce,
            revision: entry.revision,
            code: 'render_failed',
          }
    );
  };
  const entries = [committed, candidate].filter(
    (entry): entry is BuilderNativePreviewRender => entry !== null
  );
  return (
    <>
      {entries.map((entry) => {
        const pending = entry === candidate;
        return (
          <div
            key={`${entry.sessionNonce}:${entry.revision}`}
            aria-hidden={pending}
            style={
              pending
                ? {
                    visibility: 'hidden',
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                  }
                : undefined
            }
          >
            <CandidateBoundary onFailure={() => complete(entry, false)}>
              <RenderBuilderConfig
                config={entry.candidateConfig}
                merchantContext={{
                  id: entry.merchant.id,
                  slug: entry.merchant.slug,
                  basePath:
                    entry.merchant.basePath ?? `/${entry.merchant.slug}`,
                }}
                onRendered={() => complete(entry, true)}
              />
            </CandidateBoundary>
          </div>
        );
      })}
    </>
  );
}
