import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import type { JumiaGamingDraftPage } from '@/schemas/jumia/selection-draft';
import type { JumiaMappingDraft } from './jumia-mapping-draft-panel';
import { JumiaProductPreflightPreview } from './jumia-product-preflight-preview';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const INTEGRATION_ID = '00000000-0000-4000-8000-000000000002';
const SELECTION_ID = '00000000-0000-4000-8000-000000000003';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000004';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000005';
const OTHER_PRODUCT_ID = '00000000-0000-4000-8000-000000000006';
const ATTRIBUTE_SET_ID = '00000000-0000-4000-8000-000000000007';
const SOURCE_VERSION = 'a'.repeat(64);

function page(
  overrides: Partial<JumiaGamingDraftPage> = {}
): JumiaGamingDraftPage {
  return {
    selectionId: SELECTION_ID,
    sourceCategoryId: CATEGORY_ID,
    total: 2,
    page: 1,
    limit: 1,
    totalPages: 2,
    products: [
      {
        id: PRODUCT_ID,
        ordinal: 1,
        available: true,
        capturedSourceVersion: SOURCE_VERSION,
        currentSourceVersion: SOURCE_VERSION,
      },
    ],
    ...overrides,
  };
}

function mapping(
  overrides: Partial<JumiaMappingDraft> = {}
): JumiaMappingDraft {
  return {
    merchantId: MERCHANT_ID,
    integrationId: INTEGRATION_ID,
    businessClientCode: 'NG-RETAIL',
    countryCode: 'NG',
    category: { code: 123, name: 'Gaming', attributeSetId: ATTRIBUTE_SET_ID },
    brand: { code: 456, name: 'Nintendo' },
    attributeSetId: ATTRIBUTE_SET_ID,
    attributes: { '20': false, '21': undefined },
    bullets: ['One', 'Two', 'Three', 'Four'],
    categoryConfirmed: true,
    ...overrides,
  };
}

function draft(ids: readonly string[] = [PRODUCT_ID]) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        sourceCategoryId: CATEGORY_ID,
        capturedSourceVersion: SOURCE_VERSION,
      },
    ])
  );
}

function result(productIds: string[] = [PRODUCT_ID]) {
  return {
    scope: {
      selectionId: SELECTION_ID,
      sourceCategoryId: CATEGORY_ID,
      sourcePage: { page: 1, limit: 1 },
      productIds,
    },
    digest: `jumia-preflight-v1:${'b'.repeat(64)}`,
    products: productIds.map((productId) => ({
      productId,
      sourceVersion: SOURCE_VERSION,
      locallyValid: false,
      blockers: ['evidence.globalPrice:global_price_unproven'],
      recordCount: 0,
    })),
    canSubmit: false as const,
  };
}

describe('JumiaProductPreflightPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checks only this page subset, reports remaining products and never offers submission', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(Response.json(result()));
    render(
      <JumiaProductPreflightPreview
        merchantId={MERCHANT_ID}
        integrationId={INTEGRATION_ID}
        page={page()}
        selectedDraft={draft([PRODUCT_ID, OTHER_PRODUCT_ID])}
        mapping={mapping()}
      />
    );

    expect(
      screen.getByText(
        '0 checked of 1 selected on this page · 2 selected products remain unpreviewed'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    );
    expect(
      await screen.findByText(/Checked 1 of 2 selected draft products/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 checked of 1 selected on this page · 1 selected products remain unpreviewed'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('evidence.globalPrice:global_price_unproven')
    ).toBeInTheDocument();
    expect(screen.getByText('canSubmit: false')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit|publish/i })
    ).not.toBeInTheDocument();

    const [url, options] = vi.mocked(fetchWithCsrf).mock.calls[0];
    expect(url).toBe('/api/marketplace/jumia/products/preflight');
    expect(options).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(options?.body));
    expect(body.products).toEqual([
      { productId: PRODUCT_ID, sourceVersion: SOURCE_VERSION },
    ]);
    expect(body.mappings).toHaveLength(1);
    expect(body.sourcePage).toEqual({ page: 1, limit: 1 });
    expect(body.mappings[0].attributes).toEqual({ '20': false });
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('globalPrice');
    expect(body).not.toHaveProperty('images');
    expect(body).not.toHaveProperty('evidence');
  });

  it('shows loading and safe route errors without retrying or leaking details', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.mocked(fetchWithCsrf).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    render(
      <JumiaProductPreflightPreview
        merchantId={MERCHANT_ID}
        integrationId={INTEGRATION_ID}
        page={page()}
        selectedDraft={draft()}
        mapping={mapping()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    );
    const loadingButton = screen.getByRole('button', {
      name: 'Checking selected products…',
    });
    expect(loadingButton).toBeDisabled();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();

    await act(async () => {
      resolveResponse(
        Response.json(
          { error: 'Selected Jumia mapping metadata is unavailable' },
          { status: 409 }
        )
      );
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Selected Jumia mapping metadata is unavailable'
    );
    expect(screen.queryByText('access_token')).not.toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
  });

  it('rejects a response whose scope does not match the exact selected page', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      Response.json(result(['00000000-0000-4000-8000-000000000009']))
    );
    render(
      <JumiaProductPreflightPreview
        merchantId={MERCHANT_ID}
        integrationId={INTEGRATION_ID}
        page={page()}
        selectedDraft={draft()}
        mapping={mapping()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The preflight response did not match this selected page.'
    );
    expect(screen.queryByText(/jumia-preflight-v1:/)).not.toBeInTheDocument();
  });

  it('aborts and ignores an old-destination response after destination changes', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.mocked(fetchWithCsrf).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    const props = {
      merchantId: MERCHANT_ID,
      integrationId: INTEGRATION_ID,
      page: page(),
      selectedDraft: draft(),
      mapping: mapping(),
    };
    const { rerender } = render(<JumiaProductPreflightPreview {...props} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    );
    const requestSignal = vi.mocked(fetchWithCsrf).mock.calls[0][1]?.signal;
    rerender(
      <JumiaProductPreflightPreview
        {...props}
        integrationId="00000000-0000-4000-8000-000000000008"
      />
    );
    expect(requestSignal?.aborted).toBe(true);
    expect(
      screen.getByText(
        '0 checked of 1 selected on this page · 1 selected products remain unpreviewed'
      )
    ).toBeInTheDocument();
    await act(async () => {
      resolveResponse(Response.json(result()));
    });
    expect(screen.queryByText(/jumia-preflight-v1:/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    ).toBeDisabled();
  });

  it('invalidates an old response when the visible source version changes', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.mocked(fetchWithCsrf).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    const props = {
      merchantId: MERCHANT_ID,
      integrationId: INTEGRATION_ID,
      page: page(),
      selectedDraft: draft(),
      mapping: mapping(),
    };
    const { rerender } = render(<JumiaProductPreflightPreview {...props} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Check selected products on this page',
      })
    );
    rerender(
      <JumiaProductPreflightPreview
        {...props}
        page={page({
          products: [
            {
              id: PRODUCT_ID,
              ordinal: 1,
              available: true,
              capturedSourceVersion: 'c'.repeat(64),
              currentSourceVersion: 'c'.repeat(64),
            },
          ],
        })}
      />
    );
    await act(async () => {
      resolveResponse(Response.json(result()));
    });
    expect(screen.queryByText(/jumia-preflight-v1:/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/No selected product on this page still matches/)
    ).toBeInTheDocument();
  });
});
