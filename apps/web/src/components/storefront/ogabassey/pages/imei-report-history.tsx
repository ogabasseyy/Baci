// Interactive, on-demand history; no request is made during initial page load.
'use client';
import { IMEI_SERVICE_TIERS, type ImeiReport } from '@baci/shared/imei';
import { useEffect, useId, useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { ImeiCheckerError } from './imei-checker-error';
export function ImeiReportHistory({
  merchantSlug,
  onOpen,
  disabled = false,
}: {
  merchantSlug?: string;
  onOpen: (report: ImeiReport) => void;
  disabled?: boolean;
}) {
  const auth = useOptionalCustomerAuth();
  const customerId = auth?.customer?.id;
  const scope = `${merchantSlug}:${customerId}:${auth?.user?.id ?? ''}`;
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const requestScope = `${scope}:${page}:${attempt}`;
  const [state, setState] = useState<{
    scope: string;
    loading: boolean;
    reports: ImeiReport[];
    hasMore: boolean;
    error: string | null;
  }>({
    scope: requestScope,
    loading: false,
    reports: [],
    hasMore: false,
    error: null,
  });
  useEffect(() => {
    if (!expanded || !merchantSlug || !customerId) return;
    const controller = new AbortController();
    setState({
      scope: requestScope,
      loading: true,
      reports: [],
      hasMore: false,
      error: null,
    });
    void import('@baci/shared/imei/report-history')
      .then(({ fetchImeiReports }) => {
        if (controller.signal.aborted) return { reports: [], hasMore: false };
        return fetchImeiReports({
          merchantSlug,
          page,
          signal: controller.signal,
        });
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({
            scope: requestScope,
            loading: false,
            ...data,
            error: null,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            scope: requestScope,
            loading: false,
            reports: [],
            hasMore: false,
            error: 'Unable to load reports. Please try again.',
          });
      });
    return () => controller.abort();
  }, [expanded, merchantSlug, customerId, page, requestScope]);
  const visible = state.scope === requestScope;
  return (
    <section
      className="mx-auto my-6 max-w-2xl text-[var(--store-text)]"
      aria-label="Completed IMEI reports"
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={expanded}
        aria-controls={id}
        className="min-h-11 rounded-lg px-4 py-2 font-bold underline disabled:opacity-50"
        onClick={() => {
          setPage(0);
          setExpanded(!expanded);
        }}
      >
        My completed reports
      </button>
      {expanded ? (
        <div
          id={id}
          className="space-y-3 rounded-xl border border-[var(--store-border)] bg-[var(--store-surface)] p-4"
        >
          <p>
            Reopen a saved report for free. New checks are charged separately.
          </p>
          {!customerId ? (
            <ImeiCheckerError
              error="Sign in to view your completed reports."
              needsSignIn
              needsWalletFunding={false}
            />
          ) : null}
          {customerId && (!visible || state.loading) ? (
            <p role="status">Loading reports…</p>
          ) : null}
          {visible && customerId && state.error ? (
            <>
              <p role="alert">{state.error}</p>
              <button type="button" onClick={() => setAttempt(attempt + 1)}>
                Retry reports
              </button>
            </>
          ) : null}
          {visible && customerId && !state.loading && !state.error ? (
            <>
              {state.reports.length === 0 ? (
                <p>No completed reports on this page.</p>
              ) : (
                <ul>
                  {state.reports.map((report) => (
                    <li
                      key={report.lookupId}
                      className="border-b border-[var(--store-border)] py-2"
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        className="min-h-11 w-full rounded-lg p-2 text-left focus-visible:outline-2"
                        onClick={() => {
                          onOpen(report);
                          setExpanded(false);
                        }}
                      >
                        Open {IMEI_SERVICE_TIERS[report.tier].name} report for{' '}
                        {report.result.device}
                        <span className="block text-sm">
                          Ending {report.result.imei.slice(-4)} ·{' '}
                          {new Date(report.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {page > 0 ? (
                <button type="button" onClick={() => setPage(page - 1)}>
                  Newer reports
                </button>
              ) : null}
              {state.hasMore ? (
                <button type="button" onClick={() => setPage(page + 1)}>
                  Older reports
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
