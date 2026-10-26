import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PublicationRevisionMarker } from './publication-revision-marker';

it('renders the public version and actual content digest together, omitting invalid marker claims', () => {
  const version = 'published:10000000-0000-4000-8000-000000000001';
  const digest = `home-v1:${'a'.repeat(64)}`;
  const { container, rerender } = render(
    <PublicationRevisionMarker version={version} contentDigest={digest}>
      Approved homepage
    </PublicationRevisionMarker>
  );
  expect(container.firstChild).toHaveAttribute(
    'data-baci-published-version',
    version
  );
  expect(container.firstChild).toHaveAttribute(
    'data-baci-content-digest',
    digest
  );
  rerender(
    <PublicationRevisionMarker version="draft:fake" contentDigest={digest}>
      Safe homepage
    </PublicationRevisionMarker>
  );
  expect(container.firstChild).not.toHaveAttribute(
    'data-baci-published-version'
  );
});
