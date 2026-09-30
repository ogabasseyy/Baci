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
      <SearchPageForm
        key="iphone"
        action="/ogabassey/search"
        defaultQuery="iphone"
      />
    );

    // The shopper edits the input, then client-side navigation (e.g. a
    // did-you-mean link) renders the same form for another query. The
    // owner keys the form by the route query, remounting the input.
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'iphonex' },
    });
    rerender(
      <SearchPageForm
        key="galaxy"
        action="/ogabassey/search"
        defaultQuery="galaxy"
      />
    );

    expect(screen.getByLabelText('Search products')).toHaveValue('galaxy');
  });

  it('stays on the current results with feedback for stripped-only input', () => {
    render(<SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />);

    const input = screen.getByLabelText('Search products');
    fireEvent.change(input, { target: { value: '<>()' } });
    const submitted = fireEvent.submit(
      screen.getByRole('form', { name: 'Edit search' })
    );

    // Cancelled: the route would parse this to an empty query and drop
    // the shopper onto the blank search-start state.
    expect(submitted).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a searchable term to update the results.'
    );
    expect(input).toHaveValue('<>()');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('stays put for whitespace-only input', () => {
    render(<SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />);

    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: '   ' },
    });
    const submitted = fireEvent.submit(
      screen.getByRole('form', { name: 'Edit search' })
    );

    expect(submitted).toBe(false);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('submits searchable queries without feedback', () => {
    render(<SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />);

    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'galaxy' },
    });
    const submitted = fireEvent.submit(
      screen.getByRole('form', { name: 'Edit search' })
    );

    expect(submitted).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears stale feedback when navigation changes the route query', () => {
    // The form rejected a stripped-only value; the shopper then follows a
    // did-you-mean link (or the navbar) to valid results. The owner keys
    // the form by the route query, so the whole form remounts and no
    // stale alert or aria-invalid leaks onto the valid results page.
    // (A key inside the form would NOT reset its own state.)
    const { rerender } = render(
      <SearchPageForm
        key="iphone"
        action="/ogabassey/search"
        defaultQuery="iphone"
      />
    );

    const input = screen.getByLabelText('Search products');
    fireEvent.change(input, { target: { value: '<>()' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit search' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <SearchPageForm
        key="galaxy"
        action="/ogabassey/search"
        defaultQuery="galaxy"
      />
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const nextInput = screen.getByLabelText('Search products');
    expect(nextInput).toHaveValue('galaxy');
    expect(nextInput).toHaveAttribute('aria-invalid', 'false');
  });

  it('clears the feedback once the shopper edits the input', () => {
    render(<SearchPageForm action="/ogabassey/search" defaultQuery="iphone" />);

    const input = screen.getByLabelText('Search products');
    fireEvent.change(input, { target: { value: '<>()' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit search' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '<>()x' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });
});
