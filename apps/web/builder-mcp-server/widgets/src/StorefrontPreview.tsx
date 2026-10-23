import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PreviewRendererCore } from '../../../src/components/storefront/preview-renderer-core';
import type { PreviewHost } from './mcp-app-bridge';
export function StorefrontPreview({ host }: { host: PreviewHost }) {
  const state = useSyncExternalStore(host.subscribe, host.get, host.get);
  const element = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure changed DOM and late host attachment without ResizeObserver.
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const report = () => host.size(node.scrollHeight);
    report();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(node);
    window.addEventListener('resize', report);
    node.addEventListener('load', report, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', report);
      node.removeEventListener('load', report, true);
    };
  }, [
    host,
    state.preview,
    state.error,
    state.hostError,
    state.mode,
    state.ready,
    state.theme,
  ]);
  return (
    <div
      ref={element}
      className="builder-preview"
      data-theme={state.theme}
      style={{ colorScheme: state.theme }}
    >
      <header className="preview-toolbar">
        <div>
          <h1>Homepage preview</h1>
          <p>Private draft · Links and shopping controls are disabled.</p>
        </div>
        <div>
          <button
            type="button"
            disabled={!state.ready}
            onClick={() => void host.expand()}
          >
            Expand preview
          </button>
          <button
            type="button"
            disabled={!state.ready}
            onClick={() => void host.open()}
          >
            Open Baci editor
          </button>
        </div>
      </header>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.hostError ? <p role="alert">{state.hostError}</p> : null}
      {state.preview ? (
        <>
          <p className="preview-revision">Revision: {state.preview.version}</p>
          <PreviewRendererCore preview={state.preview} />
          <section aria-label="Launch readiness">
            <h2>Launch readiness</h2>
            {state.preview.readiness.ready ? (
              <p>
                Current launch checks pass. Publishing still needs separate
                approval.
              </p>
            ) : (
              <ul>
                {state.preview.readiness.missingItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            <p>
              This preview covers the homepage only. Review other pages in the
              authenticated Baci editor.
            </p>
          </section>
        </>
      ) : !state.error ? (
        <p role="status">Waiting for an authorized homepage preview…</p>
      ) : null}
    </div>
  );
}
