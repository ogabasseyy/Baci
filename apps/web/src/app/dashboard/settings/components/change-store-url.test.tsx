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
