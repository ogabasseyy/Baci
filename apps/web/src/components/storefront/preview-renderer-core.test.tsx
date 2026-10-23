import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';
import { PreviewRendererCore } from './preview-renderer-core';

const preview = {
  storefrontId: merchant.id,
  version: `draft:${merchant.id}`,
  pageSlug: 'home',
  projection: { config: home, identity: merchant, catalog, inert: true },
  readiness: { ready: true, missingItems: [] },
};
it('renders the exact authorized snapshot without navigation', () => {
  const view = render(<PreviewRendererCore preview={preview} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Authorized fixture camera')).toBeInTheDocument();
  expect(view.container.querySelector('a[href]')).toBeNull();
  expect(view.container.querySelectorAll('[data-baci-block]')).toHaveLength(6);
});
it('fails closed for malformed snapshots and unsafe assets', () => {
  for (const input of [
    {},
    {
      ...preview,
      projection: {
        ...preview.projection,
        identity: { ...merchant, logo_url: 'javascript:alert(1)' },
      },
    },
  ]) {
    const view = render(<PreviewRendererCore preview={input} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.queryByText('Authorized fixture camera')).toBeNull();
    view.unmount();
  }
});
