import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost: post }));

import { ExperienceWorkspace } from './workspace-client';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  post.mockReset();
});
it('loads complete paginated source as escaped text and patches against its digest/version', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ content: '<script>part1', nextCursor: 13 })
    )
    .mockResolvedValueOnce(
      Response.json({ content: 'part2</script>', nextCursor: null })
    );
  vi.stubGlobal('fetch', fetchImpl);
  post.mockResolvedValue({ conflict: false });
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={3}
      paths={['app.tsx']}
      builds={[]}
      draftVersion={0}
      publishedVersion={0}
      websiteRevision={id}
      enabled
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Read source' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Source' })).toHaveValue(
      '<script>part1part2</script>'
    )
  );
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Source' }), {
    target: { value: 'export default function Experience(){return null}' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save private source candidate' })
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/builder-experience/source',
      expect.objectContaining({
        baseDigest: 'a'.repeat(64),
        expectedVersion: 3,
        operation: 'patch',
      })
    )
  );
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('does not enable source save for a partial/failed read', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
  );
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={0}
      paths={['app.tsx']}
      builds={[]}
      draftVersion={0}
      publishedVersion={0}
      websiteRevision={id}
      enabled
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Read source' }));
  await screen.findByText(
    'Source unavailable. Download the complete file before editing.'
  );
  expect(
    screen.getByRole('button', { name: 'Save private source candidate' })
  ).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

const sourceReadFailures = [
  {
    name: 'accumulated content exceeds the source limit',
    responses: [
      Response.json({ content: 'x'.repeat(524289), nextCursor: null }),
    ],
  },
  {
    name: 'cursor does not advance',
    responses: [Response.json({ content: 'part', nextCursor: 0 })],
  },
  {
    name: 'cursor is not an integer',
    responses: [Response.json({ content: 'part', nextCursor: 1.5 })],
  },
  {
    name: 'response has no content',
    responses: [Response.json({ nextCursor: null })],
  },
  {
    name: 'response has no next cursor',
    responses: [Response.json({ content: 'part' })],
  },
  {
    name: 'pagination does not finish within 128 pages',
    responseForOffset: (url: string) => {
      const offset = Number(
        new URL(url, 'https://local.test').searchParams.get('offset')
      );
      return Response.json({ content: 'x', nextCursor: offset + 1 });
    },
    calls: 128,
  },
] satisfies Array<{
  name: string;
  responses?: Response[];
  responseForOffset?: (url: string) => Response;
  calls?: number;
}>;

it.each(sourceReadFailures)('keeps source save disabled when $name', async ({
  responses,
  responseForOffset,
  calls = 1,
}) => {
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve(
      responseForOffset
        ? responseForOffset(url)
        : (responses?.shift() ?? new Response(null, { status: 500 }))
    );
  });
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={0}
      paths={['app.tsx']}
      builds={[]}
      draftVersion={0}
      publishedVersion={0}
      websiteRevision={id}
      enabled
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Read source' }));
  await screen.findByText(
    'Source unavailable. Download the complete file before editing.'
  );

  expect(fetchImpl).toHaveBeenCalledTimes(calls);
  expect(
    screen.getByRole('button', { name: 'Save private source candidate' })
  ).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('renders the source comparison only while its details are open', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ content: 'complete source', nextCursor: null })
      )
  );
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={0}
      paths={['app.tsx']}
      builds={[]}
      draftVersion={0}
      publishedVersion={0}
      websiteRevision={id}
      enabled
    />
  );

  expect(screen.queryByText(/"before"/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read source' }));
  await screen.findByText('Loaded complete source file.');
  expect(screen.queryByText(/"before"/)).not.toBeInTheDocument();

  const details = screen.getByText('Source diff').closest('details');
  if (!details) throw new Error('Source diff details missing');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(screen.getByText(/"before"/)).toHaveTextContent('complete source');
});
it('private apply control requests a separate exact-build intent and cannot confirm it', async () => {
  post.mockResolvedValue({ status: 'blocked' });
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={1}
      paths={[]}
      builds={[{ id, build_digest: 'b'.repeat(64), evidenceId: id }]}
      draftVersion={2}
      publishedVersion={1}
      websiteRevision={id}
      enabled
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Request private apply review' })
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/builder-experience/request',
      expect.objectContaining({
        action: 'apply',
        merchantId: id,
        input: expect.objectContaining({
          buildId: id,
          evidenceId: id,
          expectedVersion: 2,
        }),
      })
    )
  );
  expect(JSON.stringify(post.mock.calls)).not.toContain('confirm-draft');
});

function renderPendingWorkspace() {
  render(
    <ExperienceWorkspace
      merchantId={id}
      artifactId={id}
      sourceDigest={'a'.repeat(64)}
      sourceVersion={3}
      paths={['app.tsx']}
      builds={[{ id, build_digest: 'b'.repeat(64), evidenceId: id }]}
      draftVersion={2}
      publishedVersion={1}
      websiteRevision={id}
      enabled
    />
  );
}

it('coalesces same-turn patch clicks and blocks intents until the patch settles', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ content: 'original', nextCursor: null })
      )
  );
  let settle: ((value: { conflict: boolean }) => void) | undefined;
  post.mockImplementationOnce(
    () =>
      new Promise<{ conflict: boolean }>((resolve) => {
        settle = resolve;
      })
  );
  renderPendingWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Read source' }));
  await screen.findByText('Loaded complete source file.');
  fireEvent.change(screen.getByRole('textbox', { name: 'Source' }), {
    target: { value: 'updated' },
  });
  const save = screen.getByRole('button', {
    name: 'Save private source candidate',
  });
  const apply = screen.getByRole('button', {
    name: 'Request private apply review',
  });
  act(() => {
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(apply);
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(save).toBeDisabled();
  expect(apply).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'File' })).toBeDisabled();
  expect(post.mock.calls[0][1]).toMatchObject({
    files: [{ path: 'app.tsx', content: 'updated' }],
    idempotencyKey: expect.any(String),
  });
  await act(async () => {
    settle?.({ conflict: false });
  });
  expect(apply).not.toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
});

it('allows only one pending owner intent and clears the guard after an error', async () => {
  let reject: ((reason: Error) => void) | undefined;
  post.mockImplementationOnce(
    () =>
      new Promise<never>((_, fail) => {
        reject = fail;
      })
  );
  renderPendingWorkspace();
  const apply = screen.getByRole('button', {
    name: 'Request private apply review',
  });
  const exit = screen.getByRole('button', { name: 'Exit private draft only' });
  act(() => {
    fireEvent.click(apply);
    fireEvent.click(apply);
    fireEvent.click(exit);
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(apply).toBeDisabled();
  expect(exit).toBeDisabled();
  await act(async () => {
    reject?.(Error('synthetic failure'));
  });
  expect(apply).not.toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Intent unavailable. Refresh current versions.'
  );
  post.mockResolvedValueOnce({ status: 'blocked' });
  fireEvent.click(apply);
  await screen.findByText('Complete the store readiness requirements first.');
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1][1].input.idempotencyKey).not.toBe(
    post.mock.calls[0][1].input.idempotencyKey
  );
});
