import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JumiaProductPreflightResultSummary } from './jumia-product-preflight-result-summary';

const base = {
  scope: {
    selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceCategoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourcePage: { page: 1, limit: 1 },
    productIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  },
  digest: `jumia-preflight-v1:${'a'.repeat(64)}`,
  products: [
    {
      productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceVersion: 'd'.repeat(64),
      locallyValid: false,
      blockers: ['evidence.globalPrice:global_price_unproven'],
      recordCount: 0,
    },
  ],
  canSubmit: false as const,
};

describe('JumiaProductPreflightResultSummary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows blockers and keeps the preview explicitly non-submittable', () => {
    render(
      <JumiaProductPreflightResultSummary
        result={base}
        selectedCount={3}
        checkedCount={1}
      />
    );

    expect(
      screen.getByText(/Checked 1 of 3 selected draft products/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('evidence.globalPrice:global_price_unproven')
    ).toBeInTheDocument();
    expect(screen.getByText('canSubmit: false')).toBeInTheDocument();
  });

  it('labels an empty local blocker list without claiming provider readiness', () => {
    render(
      <JumiaProductPreflightResultSummary
        result={{ ...base, products: [{ ...base.products[0], blockers: [] }] }}
        selectedCount={1}
        checkedCount={1}
      />
    );

    expect(
      screen.getByText(
        'No local blockers found. External evidence remains required.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ready|Live/)).not.toBeInTheDocument();
  });

  it('renders repeated blocker strings without duplicate React keys', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const blocker = 'source.stock:finite_managed_stock_required';
    render(
      <JumiaProductPreflightResultSummary
        result={{
          ...base,
          products: [{ ...base.products[0], blockers: [blocker, blocker] }],
        }}
        selectedCount={1}
        checkedCount={1}
      />
    );

    expect(screen.getAllByText(blocker)).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key')
    );
  });
});
