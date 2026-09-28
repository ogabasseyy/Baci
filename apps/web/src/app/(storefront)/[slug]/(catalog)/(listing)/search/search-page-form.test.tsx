import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchPageForm } from './search-page-form';

describe('SearchPageForm', () => {
  it('renders a prefilled query-editing form against the store route', () => {
    render(<SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />);

    expect(screen.getByRole('form', { name: 'Edit search' })).toHaveAttribute(
      'action',
      '/ogabassey/search'
    );
    expect(screen.getByLabelText('Search products')).toHaveValue('iphone');
  });

  it('resets the input when client-side navigation changes the query', () => {
    const { rerender } = render(
      <SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />
    );

    // The shopper edits the input, then client-side navigation (e.g. a
    // did-you-mean link) renders the same form for another query.
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'iphonex' },
    });
    rerender(
      <SearchPageForm action="/ogabassey/search" defaultQuery="galaxy" />
    );

    expect(screen.getByLabelText('Search products')).toHaveValue('galaxy');
  });
});
