'use client';

import { useEffect, useState } from 'react';
import {
  type ImeiCheckAnalytics,
  imeiAnalyticsSchema,
} from '@/schemas/imei-check-analytics';
import type { AnalyticsPeriod } from './analytics-types';

export function ImeiCheckAnalyticsPanel({
  period,
}: {
  period: AnalyticsPeriod;
}) {
  const [data, setData] = useState<ImeiCheckAnalytics | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the explicit user-triggered reload nonce.
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    const load = async () => {
      try {
        const response = await fetch(
          `/api/admin/imei-analytics?period=${period}&merchantSlug=ogabassey`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Analytics unavailable');
        const parsed = imeiAnalyticsSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error('Invalid analytics');
        if (!controller.signal.aborted) setData(parsed.data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [period, retry]);

  return (
    <section
      aria-labelledby="imei-analytics-heading"
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <div>
        <h2 id="imei-analytics-heading" className="text-lg font-semibold">
          Device check analytics · Ogabassey
        </h2>
        <p className="text-sm text-muted-foreground">
          Completed lookups count once. Polling and cached replays add no
          checks. Distinct IMEI/serial identifiers are counted separately.
        </p>
      </div>
      {error ? (
        <div role="alert" className="space-y-2">
          <p>
            Device analytics could not be loaded. No zero values are being
            substituted.
          </p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="underline"
          >
            Retry device analytics
          </button>
        </div>
      ) : !data ? (
        <p role="status">Loading device check analytics…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['Requests', data.summary.requests],
              ['Completed checks', data.summary.completed],
              ['Distinct device IDs', data.summary.uniqueDevices],
              ['Unidentified results', data.summary.unidentified],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/40 p-3">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-semibold">
                  {Number(value).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <ul
            aria-label="Most checked brands"
            className="flex flex-wrap gap-3 text-sm"
          >
            {data.topBrands.map((row) => (
              <li key={row.brand}>
                {row.brand}: {row.checks.toLocaleString()} checks
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table
              aria-label="Most checked device models"
              className="w-full text-left text-sm"
            >
              <caption className="py-2 text-left font-medium">
                Most checked models
              </caption>
              <thead>
                <tr>
                  <th scope="col">Brand</th>
                  <th scope="col">Model</th>
                  <th scope="col">Checks</th>
                  <th scope="col">Distinct device IDs</th>
                </tr>
              </thead>
              <tbody>
                {data.topModels.map((row) => (
                  <tr className="border-t" key={`${row.brand}:${row.model}`}>
                    <td className="py-2">{row.brand}</td>
                    <td>{row.model}</td>
                    <td>{row.checks.toLocaleString()}</td>
                    <td>{row.uniqueDevices.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.topModels.length && (
              <p className="py-3 text-muted-foreground">
                {data.summary.completed
                  ? 'No identified device models yet.'
                  : 'No completed checks yet.'}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table
              aria-label="Most checked device configurations"
              className="w-full text-left text-sm"
            >
              <caption className="py-2 text-left font-medium">
                Colour and storage
              </caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Colour</th>
                  <th scope="col">Storage</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {data.topVariants.map((row) => (
                  <tr
                    className="border-t"
                    key={`${row.brand}:${row.model}:${row.color}:${row.storage}`}
                  >
                    <td className="py-2">{row.model}</td>
                    <td>{row.color ?? 'Unknown'}</td>
                    <td>{row.storage ?? 'Unknown'}</td>
                    <td>{row.checks.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            {data.summary.matchedImages.toLocaleString()} completed checks
            matched a catalog image. Older reports without normalized identity
            remain unidentified. Date filters use when the check was requested.
          </p>
        </>
      )}
    </section>
  );
}
