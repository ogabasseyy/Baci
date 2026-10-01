import type { CSSProperties } from 'react';
import {
  systemErrorClassNames,
  systemErrorStyleSheet,
} from '@/app/system-error-styles';

const spinnerStyle: CSSProperties = {
  animation: 'baci-chunk-recovery-spin 0.8s linear infinite',
  border: '3px solid rgba(31, 41, 55, 0.15)',
  borderRadius: '50%',
  borderTopColor: 'rgba(31, 41, 55, 0.75)',
  height: '28px',
  margin: '0 auto 1.25rem',
  width: '28px',
};

/**
 * Shown by error boundaries while a chunk-load recovery reload is pending.
 * Reuses the self-contained system-error stylesheet (the same one
 * app/error.tsx and app/global-error.tsx render) for page/card/typography
 * styling: during a chunk outage the app's CSS chunks may be part of what
 * failed to load, so this notice must not depend on them either. Only the
 * spinner — not part of the shared sheet — stays as component-local inline
 * CSS.
 */
export function ChunkRecoveryNotice({
  wrapInDocument = false,
}: {
  wrapInDocument?: boolean;
}) {
  const notice = (
    <>
      <style>{systemErrorStyleSheet}</style>
      <style>
        {
          '@keyframes baci-chunk-recovery-spin { to { transform: rotate(360deg); } }'
        }
      </style>
      <main
        aria-live="polite"
        className={systemErrorClassNames.page}
        role="status"
      >
        <section className={systemErrorClassNames.card}>
          <div aria-hidden="true" style={spinnerStyle} />
          <p className={systemErrorClassNames.cardTitle}>
            Updating to the latest version…
          </p>
          <p className={systemErrorClassNames.copy}>
            This page is refreshing automatically.
          </p>
        </section>
      </main>
    </>
  );

  if (!wrapInDocument) {
    return notice;
  }

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{notice}</body>
    </html>
  );
}
