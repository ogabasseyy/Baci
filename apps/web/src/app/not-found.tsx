'use client';

import dynamic from 'next/dynamic';

function NotFoundLoadingFallback() {
  return (
    <main
      style={{
        alignItems: 'center',
        display: 'flex',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '1.5rem',
        textAlign: 'center',
      }}
    >
      <section aria-labelledby="not-found-loading-title">
        <h1 id="not-found-loading-title">Page not found</h1>
        <p>We could not find the page you are looking for.</p>
      </section>
    </main>
  );
}

// Lazy-load the 404 UI + inline stylesheet on demand so 200 routes neither
// serialize systemErrorStyleSheet into __next_f nor eagerly load its JS chunk.
// Default ssr: true preserves synchronous inline <style> SSR HTML on 404s.
const NotFoundContent = dynamic(() => import('./not-found-content'), {
  loading: NotFoundLoadingFallback,
});

export default function NotFound() {
  return <NotFoundContent />;
}
