'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import { productDiscoveryMetadataSchema } from '@/schemas/product-discovery-metadata';

type ReviewProduct = {
  id: string;
  name: string;
  expectedMetadata: Record<string, unknown> | null;
  draft: unknown;
  evidence: unknown;
  specifications: unknown;
  mpn: string | null;
  color: string | null;
  warnings: string[];
};
type ReviewPage = { products: ReviewProduct[]; nextCursor: string | null };

function FactEditor({ product }: { product: ReviewProduct }) {
  const [draft, setDraft] = useState(JSON.stringify(product.draft, null, 2));
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  async function save() {
    if (!reviewed || busy || saved) return;
    setBusy(true);
    setMessage('');
    try {
      const metadata = productDiscoveryMetadataSchema.parse(JSON.parse(draft));
      const response = await fetchWithCsrf('/api/products/discovery-metadata', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          metadata,
          expectedMetadata: product.expectedMetadata,
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'Facts changed. Reload this page before saving.'
            : 'Could not save verified facts.'
        );
      setSaved(true);
      setMessage('Verified facts saved.');
    } catch (error) {
      setMessage(
        error instanceof SyntaxError ||
          (error instanceof Error && error.name === 'ZodError')
          ? 'Enter a valid facts document.'
          : error instanceof Error
            ? error.message
            : 'Could not save verified facts.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{product.name}</h3>
      {product.warnings.map((warning) => (
        <p key={warning} className="text-sm">
          {warning}
        </p>
      ))}
      <details>
        <summary>Stored source fields</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(
            {
              evidence: product.evidence,
              mpn: product.mpn,
              color: product.color,
              specifications: product.specifications,
            },
            null,
            2
          )}
        </pre>
      </details>
      <label className="block">
        Facts document
        <textarea
          className="mt-1 min-h-40 w-full rounded border bg-background p-2 font-mono text-sm"
          value={draft}
          disabled={busy || saved}
          onChange={(event) => {
            setDraft(event.target.value);
            setReviewed(false);
          }}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || saved}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        I checked these facts against reliable catalog or supplier information,
        including option differences.
      </label>
      <Button disabled={!reviewed || busy || saved} onClick={save}>
        {busy ? 'Saving…' : saved ? 'Saved' : 'Save verified facts'}
      </Button>
      {message && <p role="status">{message}</p>}
    </article>
  );
}

export function DiscoveryFactsPanel() {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(cursor?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/products/discovery-metadata${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
      );
      if (!response.ok) throw new Error('Could not load catalog facts.');
      const result: ReviewPage = await response.json();
      setPage(result);
    } catch {
      setError('Could not load catalog facts. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-labelledby="verified-facts-heading">
      <h2 id="verified-facts-heading" className="text-xl font-semibold">
        Verified search facts
      </h2>
      <p className="text-sm text-muted-foreground">
        Review stored source fields before saving. Drafts are suggestions.
        Descriptions and embeddings do not verify specifications or
        compatibility. Keep variant-specific facts on their variants.
      </p>
      <Button disabled={busy} onClick={() => load()}>
        {busy
          ? 'Loading…'
          : page
            ? 'Reload first page'
            : 'Review catalog facts'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {page?.products.map((product) => (
        <FactEditor
          key={`${product.id}:${JSON.stringify(product.expectedMetadata)}`}
          product={product}
        />
      ))}
      {page?.products.length === 0 && <p>No products on this page.</p>}
      {page?.nextCursor && (
        <Button
          disabled={busy}
          onClick={() => load(page.nextCursor ?? undefined)}
        >
          Next products
        </Button>
      )}
    </section>
  );
}
