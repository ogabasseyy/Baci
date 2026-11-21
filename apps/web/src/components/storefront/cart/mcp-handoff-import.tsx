'use client';

import { Button } from '@/components/ui/button';

export function McpHandoffImport({
  error,
  retry,
}: {
  error: string | null;
  retry: () => void;
}) {
  return (
    <section aria-label="Cart handoff" className="mx-auto max-w-xl px-4 py-10">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">Could not add these items</h1>
          <p role="alert" className="mt-2 text-sm">
            {error}
          </p>
          <Button className="mt-4" onClick={retry}>
            Try again
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm">
          Opening your cart…
        </p>
      )}
    </section>
  );
}
