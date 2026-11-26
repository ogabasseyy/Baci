'use client';

import dynamic from 'next/dynamic';

// Lazy-load the 404 UI + inline stylesheet on demand so 200 routes neither
// serialize systemErrorStyleSheet into __next_f nor eagerly load its JS chunk.
// Default ssr: true preserves synchronous inline <style> SSR HTML on 404s.
const NotFoundContent = dynamic(() => import('./not-found-content'));

export default function NotFound() {
  return <NotFoundContent />;
}
