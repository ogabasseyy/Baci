'use client';

import { useRef, useState } from 'react';
import type { OwnershipDialog } from './ownership-dialog';

export function OwnershipCompare({ basePath = '' }: { basePath?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [Dialog, setDialog] = useState<typeof OwnershipDialog | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function compare() {
    if (loading) return;
    setFailed(false);
    if (Dialog) {
      setOpen(true);
      return;
    }
    setLoading(true);
    try {
      // Keep the beta SDK out of the initial storefront bundle.
      const module = await import('./ownership-dialog');
      setDialog(() => module.OwnershipDialog);
      setOpen(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="oa-compare">
      <button
        ref={trigger}
        type="button"
        className="oa-button oa-button-outline"
        aria-haspopup="dialog"
        aria-busy={loading || undefined}
        onClick={compare}
      >
        Compare ways to own <span aria-hidden="true">↗</span>
      </button>
      <span className="oa-compare-status" role="status">
        {loading ? 'Opening comparison…' : ''}
        {failed
          ? 'Comparison couldn’t load. Try again, or explore the options above.'
          : ''}
      </span>
      {Dialog && (
        <Dialog
          basePath={basePath}
          open={open}
          onOpenChange={setOpen}
          finalFocus={() => trigger.current}
        />
      )}
    </div>
  );
}
