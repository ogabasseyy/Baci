'use client';
import { useRef, useState } from 'react';
import { apiPost } from '@/lib/api-client';

interface Props {
  merchantId: string;
  artifactId: string | null;
  sourceVersion: number;
  sourceDigest: string | null;
  paths: string[];
  builds: Array<{ id: string; build_digest: string; evidenceId?: string }>;
  draftVersion: number;
  publishedVersion: number;
  websiteRevision: string | null;
  enabled: boolean;
}
export function ExperienceWorkspace(p: Props) {
  const [path, setPath] = useState(p.paths[0] ?? '');
  const [before, setBefore] = useState('');
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  async function read() {
    if (!p.artifactId || loading || inFlight.current) return;
    setLoading(true);
    setComplete(false);
    try {
      let offset = 0;
      let source = '';
      let finished = false;
      for (let page = 0; page < 128; page++) {
        const r = await fetch(
          `/api/builder-experience/source?${new URLSearchParams({ merchant: p.merchantId, artifact: p.artifactId, path, offset: String(offset) })}`,
          { cache: 'no-store' }
        );
        if (!r.ok) throw Error();
        const v: unknown = await r.json();
        if (
          typeof v !== 'object' ||
          v === null ||
          !('content' in v) ||
          typeof v.content !== 'string' ||
          !('nextCursor' in v)
        )
          throw Error();
        source += v.content;
        if (new TextEncoder().encode(source).length > 524288) throw Error();
        if (v.nextCursor === null) {
          finished = true;
          break;
        }
        if (
          typeof v.nextCursor !== 'number' ||
          !Number.isSafeInteger(v.nextCursor) ||
          v.nextCursor <= offset
        )
          throw Error();
        offset = v.nextCursor;
      }
      if (!finished) throw Error();
      setBefore(source);
      setContent(source);
      setComplete(true);
      setMessage('Loaded complete source file.');
    } catch {
      setMessage(
        'Source unavailable. Download the complete file before editing.'
      );
    } finally {
      setLoading(false);
    }
  }
  async function patch() {
    if (
      !p.enabled ||
      !complete ||
      !p.sourceDigest ||
      loading ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await apiPost<{ conflict?: boolean }>(
        '/api/builder-experience/source',
        {
          storefrontId: p.merchantId,
          operation: 'patch',
          baseDigest: p.sourceDigest,
          expectedVersion: p.sourceVersion,
          files: [{ path, content }],
          idempotencyKey: crypto.randomUUID(),
        }
      );
      setComplete(false);
      setMessage(
        result.conflict
          ? 'Source changed. The candidate is retained; reload the current version.'
          : 'Private source candidate saved. Reload the workspace, then build and review before applying.'
      );
    } catch {
      setMessage('Patch unavailable. Refresh the current source version.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  async function intent(
    action: 'apply' | 'publish' | 'rollback' | 'mode-exit',
    buildId?: string,
    effect?: string,
    evidenceId?: string
  ) {
    if (!p.enabled || loading || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const input =
        action === 'apply'
          ? {
              buildId,
              evidenceId,
              expectedVersion: p.draftVersion,
              idempotencyKey: crypto.randomUUID(),
            }
          : action === 'mode-exit'
            ? {
                expectedDraftVersion: p.draftVersion,
                expectedPublishedVersion: p.publishedVersion,
                targetLegacyRevision: p.websiteRevision,
                effect,
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                storefrontId: p.merchantId,
                buildId,
                expectedDraftVersion: p.draftVersion,
                expectedPublishedVersion: p.publishedVersion,
                idempotencyKey: crypto.randomUUID(),
              };
      const v = await apiPost<{ status: string; approvalId?: string }>(
        '/api/builder-experience/request',
        { action, merchantId: p.merchantId, input }
      );
      if (v.approvalId)
        location.assign(
          `/builder/experience/approve?kind=${action === 'apply' ? 'draft' : 'lifecycle'}&approval=${encodeURIComponent(v.approvalId)}`
        );
      else
        setMessage(
          v.status === 'blocked'
            ? 'Complete the store readiness requirements first.'
            : 'Request unavailable.'
        );
    } catch {
      setMessage('Intent unavailable. Refresh current versions.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <main>
      <h1>Full-code experience workspace</h1>
      <p>
        Your React, TypeScript, CSS and interactions remain custom. Baci
        supplies commerce.
      </p>
      {!p.enabled ? <p>Build and approval runtime is unavailable.</p> : null}
      <section>
        <h2>Private source</h2>
        <label>
          File
          <select
            disabled={loading || pending}
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setBefore('');
              setContent('');
              setComplete(false);
            }}
          >
            {p.paths.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={read}
          disabled={!path || loading || pending}
        >
          Read source
        </button>
        {p.artifactId && path ? (
          <a
            href={`/api/builder-experience/source?${new URLSearchParams({ merchant: p.merchantId, artifact: p.artifactId, path, download: '1' })}`}
          >
            Download complete file
          </a>
        ) : null}
        <label>
          Source
          <textarea
            aria-label="Source"
            disabled={loading || pending}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <details onToggle={(e) => setShowDiff(e.currentTarget.open)}>
          <summary>Source diff</summary>
          {showDiff ? (
            <pre>{JSON.stringify({ before, after: content }, null, 2)}</pre>
          ) : null}
        </details>
        <button
          type="button"
          disabled={
            !p.enabled ||
            pending ||
            loading ||
            !complete ||
            !p.sourceDigest ||
            before === content
          }
          onClick={patch}
        >
          Save private source candidate
        </button>
      </section>
      <section>
        <h2>Immutable builds</h2>
        {p.builds.map((b) => (
          <article key={b.id}>
            <code>{b.build_digest}</code>
            <a
              href={`/builder/experience/preview?merchant=${p.merchantId}&build=${b.id}`}
            >
              Private preview
            </a>
            <button
              type="button"
              disabled={!p.enabled || loading || pending || !b.evidenceId}
              onClick={() => intent('apply', b.id, undefined, b.evidenceId)}
            >
              Request private apply review
            </button>
            <button
              type="button"
              disabled={!p.enabled || loading || pending}
              onClick={() => intent('publish', b.id)}
            >
              Request publication review
            </button>
            <button
              type="button"
              disabled={!p.enabled || loading || pending}
              onClick={() => intent('rollback', b.id)}
            >
              Request rollback review
            </button>
          </article>
        ))}
      </section>
      <section>
        <h2>Exit full-code mode</h2>
        <p>
          Review an explicit legacy effect. Source history is retained and AI
          does not resume automatically.
        </p>
        {['draft-only', 'restore-legacy', 'unpublish-legacy-draft'].map(
          (effect) => (
            <button
              type="button"
              key={effect}
              disabled={!p.enabled || loading || pending || !p.websiteRevision}
              onClick={() => intent('mode-exit', undefined, effect)}
            >
              {effect === 'draft-only'
                ? 'Exit private draft only'
                : effect === 'restore-legacy'
                  ? 'Review compatible legacy restore'
                  : 'Review unpublish and legacy draft'}
            </button>
          )
        )}
      </section>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
