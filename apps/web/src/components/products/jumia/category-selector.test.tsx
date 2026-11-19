import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaCategorySelector } from './category-selector';

const sid = '11111111-1111-4111-8111-111111111111';
const leaf = {
  code: 4,
  name: 'Games',
  completePath: 'Gaming / Games',
  hasChildren: false,
  attributeSet: { sid, name: 'Games' },
};
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});
describe('Jumia category metadata', () => {
  it('reuses successful categories on reopen but refetches for a new client', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ categories: [leaf] }))
    );
    vi.stubGlobal('fetch', fetcher);
    const props = {
      merchantId: 'merchant',
      integrationId: 'integration',
      onSelect: vi.fn(),
    };
    const { rerender } = render(
      <JumiaCategorySelector {...props} businessClientCode="jumia-ng" />
    );
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(
      await screen.findByRole('option', { name: /Gaming \/ Games/ })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox'));
    });
    expect(
      screen.getByRole('option', { name: /Gaming \/ Games/ })
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender(
      <JumiaCategorySelector {...props} businessClientCode="jumia-gh" />
    );
    fireEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Gaming \/ Games/ });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('returns the category SID and prevents parent category mapping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          categories: [
            leaf,
            {
              ...leaf,
              code: 5,
              name: 'Gaming',
              completePath: 'Gaming',
              hasChildren: true,
            },
          ],
        })
      )
    );
    const onSelect = vi.fn();
    render(
      <JumiaCategorySelector
        merchantId="merchant"
        integrationId="integration"
        businessClientCode="jumia-ng"
        leafOnly
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', {
      name: /Gaming \/ Games/,
    });
    expect(screen.getByRole('option', { name: /^Gaming$/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith({
      code: 4,
      name: 'Games',
      attributeSetId: sid,
    });
  });
  it('clears old categories and fences a late result when integration changes', async () => {
    let resolveOld: (value: Response) => void = () => undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce(
        Response.json({
          categories: [{ ...leaf, name: 'New', completePath: 'New' }],
        })
      );
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(
      <JumiaCategorySelector
        merchantId="merchant"
        integrationId="old"
        businessClientCode="jumia-ng"
        onSelect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender(
      <JumiaCategorySelector
        merchantId="merchant"
        integrationId="new"
        businessClientCode="jumia-ng"
        onSelect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: 'New' });
    await act(async () => {
      resolveOld(Response.json({ categories: [leaf] }));
    });
    expect(
      screen.queryByRole('option', { name: /Gaming \/ Games/ })
    ).not.toBeInTheDocument();
    expect(fetcher.mock.calls[1][0]).toContain('integrationId=new');
    expect(fetcher.mock.calls[1][0]).toContain('businessClientCode=jumia-ng');
  });
});
