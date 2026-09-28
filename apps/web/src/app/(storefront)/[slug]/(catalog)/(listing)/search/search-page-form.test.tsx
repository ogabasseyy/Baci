import { render, screen } from '@testing-library/react';
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
});
