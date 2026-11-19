import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMerchant = vi.hoisted(() => ({
  id: 'merchant-1',
  slug: 'oldstore',
  custom_domain: undefined as string | undefined,
}));
const mockApiPost = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    merchant: mockMerchant,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

const { ChangeStoreUrl } = await import('./change-store-url');

function typeNewSlug(value: string) {
  fireEvent.change(screen.getByLabelText('New URL'), {
    target: { value },
  });
}

describe('ChangeStoreUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMerchant.id = 'merchant-1';
    mockMerchant.slug = 'oldstore';
    mockMerchant.custom_domain = undefined;
  });

  it('shows the current store URL', () => {
    render(<ChangeStoreUrl />);
    expect(
      screen.getByText((_, el) => el?.textContent === 'oldstore.usebaci.com')
    ).toBeInTheDocument();
  });

  it('shows the active custom domain separately from the editable Baci address', () => {
    mockMerchant.custom_domain = 'ogabassey.com';
    render(<ChangeStoreUrl />);

    expect(
      screen.getByText('Current URL').nextElementSibling
    ).toHaveTextContent('ogabassey.com');
    expect(
      screen.getByText('Baci subdomain').nextElementSibling
    ).toHaveTextContent('oldstore.usebaci.com');
    expect(screen.getByLabelText('New Baci subdomain')).toBeInTheDocument();
    expect(
      screen.getByText(/Changing your Baci subdomain does not change/)
    ).toBeInTheDocument();
  });

  it('returns to the Baci address when the active custom domain is removed', () => {
    mockMerchant.custom_domain = 'ogabassey.com';
    const { rerender } = render(<ChangeStoreUrl />);
    mockMerchant.custom_domain = undefined;
    rerender(<ChangeStoreUrl />);

    expect(
      screen.getByText('Current URL').nextElementSibling
    ).toHaveTextContent('oldstore.usebaci.com');
    expect(screen.queryByText('ogabassey.com')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New URL')).toBeInTheDocument();
  });

  describe('bugfix: generated Baci subdomain is not a custom domain', () => {
    it('keeps the plain Store URL card when the primary domain is the generated Baci address', () => {
      // get_user_merchant_context() returns the primary active domain row even
      // when it is the generated subdomain, so custom_domain can hold it.
      mockMerchant.custom_domain = 'oldstore.usebaci.com';
      render(<ChangeStoreUrl />);

      expect(screen.queryByText('Baci subdomain')).not.toBeInTheDocument();
      expect(
        screen.queryByText(/custom domain is active/i)
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText('New URL')).toBeInTheDocument();
      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('oldstore.usebaci.com');
    });

    it('ignores a stale generated Baci address left in the context after a rename', () => {
      mockMerchant.slug = 'newstore';
      mockMerchant.custom_domain = 'oldstore.usebaci.com';
      render(<ChangeStoreUrl />);

      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('newstore.usebaci.com');
      expect(screen.queryByText('Baci subdomain')).not.toBeInTheDocument();
    });

    it('still treats a lookalike domain outside the Baci root as custom', () => {
      mockMerchant.custom_domain = 'usebaci.com.shop.example';
      render(<ChangeStoreUrl />);

      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('usebaci.com.shop.example');
      expect(screen.getByLabelText('New Baci subdomain')).toBeInTheDocument();
    });
  });

  describe('bugfix: custom-domain rename confirmation', () => {
    async function renameWithCustomDomain() {
      mockMerchant.custom_domain = 'ogabassey.com';
      mockApiPost.mockResolvedValue({
        slug: 'newstore',
        url: 'https://newstore.usebaci.com',
      });
      render(<ChangeStoreUrl />);
      fireEvent.change(screen.getByLabelText('New Baci subdomain'), {
        target: { value: 'newstore' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Change URL' })
      );
      await waitFor(() => expect(mockToast).toHaveBeenCalled());
    }

    it('says only the Baci subdomain changed and the custom domain is unchanged', async () => {
      await renameWithCustomDomain();

      const toast = mockToast.mock.calls[0][0] as {
        title: string;
        description: string;
      };
      expect(toast.title).toBe('Baci subdomain changed');
      expect(toast.description).toContain('newstore.usebaci.com');
      expect(toast.description).toContain('ogabassey.com');
      expect(toast.description).not.toContain('Your store is now at');
    });

    it('shows the renamed Baci subdomain without touching the custom domain', async () => {
      await renameWithCustomDomain();

      expect(
        screen.getByText('Baci subdomain').nextElementSibling
      ).toHaveTextContent('newstore.usebaci.com');
      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('ogabassey.com');
    });

    it('keeps the Baci subdomain and shows the error when the rename fails', async () => {
      mockMerchant.custom_domain = 'ogabassey.com';
      mockApiPost.mockRejectedValue(
        new Error('That store URL is already taken.')
      );
      render(<ChangeStoreUrl />);
      fireEvent.change(screen.getByLabelText('New Baci subdomain'), {
        target: { value: 'takenstore' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Change URL' })
      );

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Could not change URL',
            description: 'That store URL is already taken.',
            variant: 'destructive',
          })
        )
      );
      expect(
        screen.getByText('Baci subdomain').nextElementSibling
      ).toHaveTextContent('oldstore.usebaci.com');
    });
  });

  describe('bugfix: displayed address after a successful rename', () => {
    async function renameTo(slug: string, label: string) {
      mockApiPost.mockResolvedValue({
        slug,
        url: `https://${slug}.usebaci.com`,
      });
      const view = render(<ChangeStoreUrl />);
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: slug },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Change URL' })
      );
      await waitFor(() => expect(mockToast).toHaveBeenCalled());
      return view;
    }

    it('shows the new address as the current URL when no custom domain is active', async () => {
      await renameTo('newstore', 'New URL');

      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('newstore.usebaci.com');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Store URL changed' })
      );
    });

    it('treats the new address as unchanged so it cannot be submitted again', async () => {
      await renameTo('newstore', 'New URL');

      fireEvent.change(screen.getByLabelText('New URL'), {
        target: { value: 'newstore' },
      });
      expect(screen.getByRole('button', { name: 'Change URL' })).toBeDisabled();
    });

    it('defers to the refreshed merchant context once it has the new slug', async () => {
      const { rerender } = await renameTo('newstore', 'New URL');
      mockMerchant.slug = 'newstore';
      rerender(<ChangeStoreUrl />);

      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('newstore.usebaci.com');
    });

    it('does not leak the renamed address onto another selected store', async () => {
      const { rerender } = await renameTo('newstore', 'New URL');
      mockMerchant.id = 'merchant-2';
      mockMerchant.slug = 'otherstore';
      rerender(<ChangeStoreUrl />);

      expect(
        screen.getByText('Current URL').nextElementSibling
      ).toHaveTextContent('otherstore.usebaci.com');
    });
  });

  it('disables the change button for an empty or unchanged slug', () => {
    render(<ChangeStoreUrl />);
    const button = screen.getByRole('button', { name: 'Change URL' });
    expect(button).toBeDisabled();

    typeNewSlug('oldstore'); // same as current
    expect(button).toBeDisabled();

    typeNewSlug('ab'); // too short
    expect(button).toBeDisabled();

    typeNewSlug('newstore'); // valid + changed
    expect(button).toBeEnabled();
  });

  it('renames through the API and confirms success', async () => {
    mockApiPost.mockResolvedValue({
      slug: 'newstore',
      url: 'https://newstore.usebaci.com',
    });
    render(<ChangeStoreUrl />);

    typeNewSlug('newstore');
    fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change URL' }));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith('/api/merchant/rename-slug', {
        merchantId: 'merchant-1',
        new_slug: 'newstore',
      })
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Store URL changed' })
      )
    );
  });

  it('renames only the Baci subdomain when a custom domain is active', async () => {
    mockMerchant.custom_domain = 'ogabassey.com';
    mockApiPost.mockResolvedValue({
      slug: 'newstore',
      url: 'https://newstore.usebaci.com',
    });
    render(<ChangeStoreUrl />);
    fireEvent.change(screen.getByLabelText('New Baci subdomain'), {
      target: { value: 'newstore' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Your Baci subdomain will change from');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change URL' }));
    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith('/api/merchant/rename-slug', {
        merchantId: 'merchant-1',
        new_slug: 'newstore',
      })
    );
    expect(
      screen.getByText('Current URL').nextElementSibling
    ).toHaveTextContent('ogabassey.com');
  });

  it('surfaces the server error message when the rename fails', async () => {
    mockApiPost.mockRejectedValue(
      new Error('That store URL is already taken.')
    );
    render(<ChangeStoreUrl />);

    typeNewSlug('takenstore');
    fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change URL' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not change URL',
          description: 'That store URL is already taken.',
          variant: 'destructive',
        })
      )
    );
  });

  it('shows a disabled loading state while the rename is in flight', async () => {
    let resolveRename!: (value: { slug: string; url: string }) => void;
    mockApiPost.mockReturnValue(
      new Promise<{ slug: string; url: string }>((resolve) => {
        resolveRename = resolve;
      })
    );
    render(<ChangeStoreUrl />);

    typeNewSlug('newstore');
    fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change URL' }));

    // While the request is pending, the trigger shows the loading label and is
    // disabled so the merchant can't double-submit.
    const loadingButton = await screen.findByRole('button', {
      name: /changing/i,
    });
    expect(loadingButton).toBeDisabled();

    // Let it settle so the test doesn't leak a pending promise / act() warning.
    resolveRename({ slug: 'newstore', url: 'https://newstore.usebaci.com' });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Store URL changed' })
      )
    );
  });
});
