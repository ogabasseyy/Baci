'use client';

import Link from 'next/link';
import {
  systemErrorClassNames,
  systemErrorStyleSheet,
} from './system-error-styles';

export default function NotFoundContent() {
  return (
    <>
      <style>{systemErrorStyleSheet}</style>
      <main className={systemErrorClassNames.page}>
        <section
          aria-labelledby="not-found-title"
          className={systemErrorClassNames.shell}
        >
          <Link className={systemErrorClassNames.brand} href="/">
            Baci
          </Link>
          <p aria-hidden="true" className={systemErrorClassNames.statusCode}>
            404
          </p>
          <h1 className={systemErrorClassNames.title} id="not-found-title">
            Page not found
          </h1>
          <p className={systemErrorClassNames.copy}>
            We could not find the page you are looking for. It may have moved,
            or the link may be incorrect.
          </p>
          <div className={systemErrorClassNames.actions}>
            <Link className={systemErrorClassNames.button} href="/">
              Go home
            </Link>
            <Link
              className={`${systemErrorClassNames.button} ${systemErrorClassNames.buttonSecondary}`}
              href="/contact"
            >
              Contact support
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
