import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { loadUnpublishedStorefront } from './unpublished-storefront';

describe('loadUnpublishedStorefront', () => {
  it('loads the upcoming-store notice without a static CSS import in callers', async () => {
    const StoreNotPublished = await loadUnpublishedStorefront();

    render(<StoreNotPublished businessName="Ada & Co." />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ada & Co.' })
    ).toBeInTheDocument();
    expect(screen.getByText('Opening soon')).toBeInTheDocument();
  });
});
