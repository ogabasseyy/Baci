import { isValidElement } from 'react';
import { renderToReadableStream } from 'react-dom/server.edge';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  })),
}));

import WorkspacePage from '../page';
import PreviewPage from '../preview/page';
import ApprovalPage from './page';

it.each([
  { Page: ApprovalPage, title: 'Approval unavailable' },
  { Page: WorkspacePage, title: 'Experience workspace unavailable' },
  { Page: PreviewPage, title: 'Private full-code preview' },
])('streams a safe shell while request parameters are unavailable for $title', async ({
  Page,
  title,
}) => {
  let release: (value: Record<string, string | undefined>) => void = () => {};
  const searchParams = new Promise<Record<string, string | undefined>>(
    (resolve) => {
      release = resolve;
    }
  );
  const page = Page({ searchParams });
  expect(isValidElement(page)).toBe(true);
  const stream = await renderToReadableStream(
    <html lang="en">
      <body>{page}</body>
    </html>
  );
  const reader = stream.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('Loading');
  release({ approval: 'bad', merchant: 'bad', build: 'bad' });
  let html = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    html += new TextDecoder().decode(next.value);
  }
  expect(html).toContain(title);
});
