import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductGridDidYouMean } from './product-grid-did-you-mean';

const fetchMock = vi.fn();
const defaultProps = {
  didYouMean: 'iphone',
  searchQuery: 'iphon',
  basePath: '/ogabassey',
  onSelectSuggestion: vi.fn(),
};

describe('product grid did-you-mean', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    defaultProps.onSelectSuggestion.mockReset();
  });

  it.each([
    { didYouMean: null, searchQuery: 'iphon' },
    { didYouMean: 'iphone', searchQuery: '' },
  ])('renders nothing without a suggestion or query: %j', (overrides) => {
    const { container } = render(
      <ProductGridDidYouMean {...defaultProps} {...overrides} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records the correction and applies it on suggestion click', () => {
    render(<ProductGridDidYouMean {...defaultProps} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /iphone/ }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search/submissions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: 'iphone',
      pathPrefix: '/ogabassey',
      source: 'did-you-mean',
    });
    expect(defaultProps.onSelectSuggestion).toHaveBeenCalledExactlyOnceWith(
      'iphone'
    );
  });

  it('still applies the correction when tracking is unavailable', () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<ProductGridDidYouMean {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /iphone/ }));
    expect(defaultProps.onSelectSuggestion).toHaveBeenCalledExactlyOnceWith(
      'iphone'
    );
  });
});
