import { Writable } from 'node:stream';
import { render, screen } from '@testing-library/react';
import { type ReactElement, Suspense } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHeaders = vi.hoisted(() => vi.fn());
const mockLoadComparePage = vi.fn();
const mockStorefrontRouteNotFoundContent = vi.fn(
  (props: { backHref: string; message: string; title: string }) => (
    <main data-testid="compare-soft-not-found">
      <h1>{props.title}</h1>
      <p>{props.message}</p>
      <a href={props.backHref}>Back</a>
    </main>
  )
);

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/storefront-compare/load-compare-page', () => ({
  loadComparePage: (...args: unknown[]) => mockLoadComparePage(...args),
}));

vi.mock('@/app/(storefront)/[slug]/storefront-route-not-found-content', () => ({
  StorefrontRouteNotFoundContent: (props: {
    backHref: string;
    message: string;
    title: string;
  }) => mockStorefrontRouteNotFoundContent(props),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

const routeParams = {
  slug: 'ogabassey',
  category: 'laptops',
  comparisonSlug: 'dell-xps-15-9510-vs-macbook-air-13-inch-2020-intel',
};

function createRouteElement(
  ComparePageContent: typeof import('./compare-page-content').ComparePageContent
) {
  return ComparePageContent({ params: Promise.resolve(routeParams) });
}

describe('ComparePageContent fallback boundary', () => {
  beforeEach(() => {
    mockHeaders.mockResolvedValue(new Headers());
    mockLoadComparePage.mockReset();
    mockStorefrontRouteNotFoundContent.mockClear();
  });

  it('renders a marker-free soft 404 for an unknown comparison instead of throwing', async () => {
    mockLoadComparePage.mockResolvedValueOnce(null);
    const { ComparePageContent } = await import('./compare-page-content');

    render(await createRouteElement(ComparePageContent));

    expect(
      screen.getByRole('heading', { name: 'Comparison not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This comparison is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
    expect(mockStorefrontRouteNotFoundContent).toHaveBeenCalledWith({
      backHref: '/ogabassey',
      message: 'This comparison is unavailable or has moved.',
      title: 'Comparison not found',
    });
  });

  it('streams an unresolved soft 404 without a React error marker after the shell flushes', async () => {
    let resolveLoader!: (value: null) => void;
    const pendingLoader = new Promise<null>((resolve) => {
      resolveLoader = resolve;
    });
    mockLoadComparePage.mockReturnValueOnce(pendingLoader);
    const { ComparePageContent } = await import('./compare-page-content');

    const chunks: string[] = [];
    const errors: unknown[] = [];
    let resolveFallbackReady!: () => void;
    const fallbackReady = new Promise<void>((resolve) => {
      resolveFallbackReady = resolve;
    });
    const output = new Writable({
      write(chunk, _encoding, callback) {
        const text = Buffer.from(chunk).toString('utf8');
        chunks.push(text);
        if (chunks.join('').includes('Compare route pending')) {
          resolveFallbackReady();
        }
        callback();
      },
    });
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    output.on('finish', resolveFinished);

    let stream!: ReturnType<typeof renderToPipeableStream>;
    let contentReady = false;
    let content: ReactElement | null = null;
    const contentPromise = createRouteElement(ComparePageContent).then(
      (resolvedContent) => {
        content = resolvedContent;
        contentReady = true;
      }
    );
    function UnresolvedComparePage() {
      if (!contentReady) {
        throw contentPromise;
      }
      return content;
    }

    stream = renderToPipeableStream(
      <main>
        <div id="storefront-ppr-shell">Storefront shell</div>
        <Suspense fallback={<div>Compare route pending</div>}>
          <UnresolvedComparePage />
        </Suspense>
      </main>,
      {
        onShellReady() {
          stream.pipe(output);
        },
        onError(error) {
          errors.push(error);
        },
      }
    );

    await fallbackReady;
    resolveLoader(null);
    await finished;
    const html = chunks.join('');

    expect(html).toContain('Storefront shell');
    expect(html).toContain('Compare route pending');
    expect(html).toContain('Comparison not found');
    expect(html).not.toContain('$RX(');
    expect(html).not.toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(errors).toEqual([]);
  });

  it('links a subdomain soft 404 to that host homepage', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'ogabassey.usebaci.com'],
        ['x-merchant-slug', 'ogabassey'],
      ])
    );
    mockLoadComparePage.mockResolvedValueOnce(null);
    const { ComparePageContent } = await import('./compare-page-content');

    render(await createRouteElement(ComparePageContent));

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('propagates loader errors instead of converting genuine failures to a soft 404', async () => {
    const loaderError = new Error('compare data unavailable');
    mockLoadComparePage.mockRejectedValueOnce(loaderError);
    const { ComparePageContent } = await import('./compare-page-content');

    await expect(createRouteElement(ComparePageContent)).rejects.toThrow(
      loaderError
    );
    expect(mockStorefrontRouteNotFoundContent).not.toHaveBeenCalled();
  });
});
