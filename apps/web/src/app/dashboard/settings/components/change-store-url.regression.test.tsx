import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ChangeStoreUrl,
  confirmRename,
  mockApiPost,
  mockMerchant,
  mockToast,
  openRenameDialog,
  resetChangeStoreUrlTestState,
  typeNewSlug,
} from './change-store-url.test-utils';

describe('ChangeStoreUrl regressions', () => {
  beforeEach(() => {
    resetChangeStoreUrlTestState();
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
      typeNewSlug('newstore', 'New Baci subdomain');
      confirmRename(await openRenameDialog());
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
      typeNewSlug('takenstore', 'New Baci subdomain');
      confirmRename(await openRenameDialog());

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
      typeNewSlug(slug, label);
      confirmRename(await openRenameDialog());
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

      typeNewSlug('newstore');
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
});
