import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../../tools/builder-preview-spike/fixtures';
import { PublicPortableHome } from './public-portable-home';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiGet: mocks.get }));

describe('coherent public render snapshot', () => {
  it('does not render mutable input after versioning it', async () => {
    mocks.get.mockResolvedValue({
      products: catalog.products.map((product) => ({
        ...product,
        status: 'active',
      })),
    });
    const source = structuredClone(home);
    const { container, rerender } = render(
      <PublicPortableHome config={source} merchant={merchant} basePath="" />
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Our cameras' })
      ).toBeInTheDocument()
    );
    const version = container
      .querySelector('[data-published-version]')
      ?.getAttribute('data-published-version');
    const hero = source.content.find((block) => block.type === 'Hero');
    if (!hero) throw new Error('Missing hero');
    hero.props.title = 'Unversioned mutable change';
    rerender(
      <PublicPortableHome config={source} merchant={merchant} basePath="" />
    );
    expect(
      screen.queryByRole('heading', { name: 'Unversioned mutable change' })
    ).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Our cameras' })
    ).toBeInTheDocument();
    expect(container.querySelector('[data-published-version]')).toHaveAttribute(
      'data-published-version',
      version
    );
  });
  it('refuses an unknown renderer version before loading a catalog', async () => {
    mocks.get.mockClear();
    render(
      <PublicPortableHome
        config={{
          ...home,
          root: { props: { ...home.root.props, rendererVersion: 'unknown' } },
        }}
        merchant={merchant}
        basePath=""
      />
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
