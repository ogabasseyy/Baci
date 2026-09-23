'use client';

import { Loader2, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { RepairStatusTimeline } from '@/components/repairs/repair-status-timeline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchWithCsrf } from '@/lib/api-client';
import type { RepairStatusResult } from '@/lib/repairs/status-lookup';

interface RepairStatusLookupProps {
  initialTicket?: string;
  slug: string;
}

type LookupResponse =
  | { kind: 'found'; repair: RepairStatusResult }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

// Module-scope helper keeps try/throw control flow out of the component body so
// React Compiler can memoize it (mirrors the platform tracking page pattern).
async function fetchRepairStatus(
  slug: string,
  ticketNumber: string,
  email: string
): Promise<LookupResponse> {
  const response = await fetchWithCsrf(
    `/api/storefront/${encodeURIComponent(slug)}/repair/status`,
    {
      method: 'POST',
      body: JSON.stringify({ ticketNumber, email }),
    }
  );

  if (response.status === 429) {
    return {
      kind: 'error',
      message: 'Too many lookups. Please wait a moment and try again.',
    };
  }
  if (response.status === 400) {
    return {
      kind: 'error',
      message: 'Please enter a valid ticket number and email.',
    };
  }
  if (!response.ok) {
    return {
      kind: 'error',
      message: 'Something went wrong. Please try again.',
    };
  }

  const data = (await response.json()) as {
    found: boolean;
    repair?: RepairStatusResult;
  };
  if (data.found && data.repair) {
    return { kind: 'found', repair: data.repair };
  }
  return { kind: 'not_found' };
}

export function RepairStatusLookup({
  initialTicket,
  slug,
}: RepairStatusLookupProps) {
  const [ticketNumber, setTicketNumber] = useState(initialTicket ?? '');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RepairStatusResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setNotFound(false);

    fetchRepairStatus(slug, ticketNumber, email)
      .then((outcome) => {
        if (outcome.kind === 'found') {
          setResult(outcome.repair);
        } else if (outcome.kind === 'not_found') {
          setNotFound(true);
        } else {
          setError(outcome.message);
        }
      })
      .catch(() => {
        setError('Something went wrong. Please try again.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="repair-ticket">Ticket number</Label>
          <Input
            autoComplete="off"
            id="repair-ticket"
            inputMode="numeric"
            onChange={(event) => setTicketNumber(event.target.value)}
            placeholder="e.g. 1042"
            required
            value={ticketNumber}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repair-email">Email used to book</Label>
          <Input
            autoComplete="email"
            id="repair-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </div>
        <Button className="w-full" disabled={loading} type="submit">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          Check status
        </Button>
      </form>

      {error ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-red-600 text-sm">
          {error}
        </p>
      ) : null}

      {notFound ? (
        <p className="rounded-lg border border-store-border bg-store-background-text/5 px-4 py-3 text-sm text-store-background-text/70">
          We couldn't find a repair matching that ticket number and email.
          Double-check both and try again.
        </p>
      ) : null}

      {result ? (
        <RepairStatusTimeline
          result={result}
          trackHref={
            result.trackingNumber
              ? `/track/${encodeURIComponent(result.trackingNumber)}`
              : null
          }
        />
      ) : null}
    </div>
  );
}
