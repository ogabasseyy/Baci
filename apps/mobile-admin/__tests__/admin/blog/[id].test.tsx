// biome-ignore assist/source/organizeImports: load test-support mocks before the screen module
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blogPostTestSupport } from './[id].test-support';
import BlogPostDetailScreen from '../../../app/(admin)/blog/[id]';

const mocks = blogPostTestSupport.getMocks();

describe('BlogPostDetailScreen - Delete handler', () => {
  beforeEach(() => {
    blogPostTestSupport.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('scopes delete query to merchant_id for tenant isolation', async () => {
    const { eqId, eqMerchant } = blogPostTestSupport.setupSupabaseMocks({
      error: null,
    });

    await act(async () => {
      render(<BlogPostDetailScreen />);
    });

    await waitFor(() => {
      expect(screen.getByText('Delete Post')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Delete Post'));
    expect(mocks.alert).toHaveBeenCalledWith(
      'Delete Post',
      'Are you sure?',
      expect.any(Array)
    );

    const deleteConfirm = blogPostTestSupport.getDeleteConfirmButton();
    expect(deleteConfirm).toBeDefined();

    await act(async () => {
      await deleteConfirm?.onPress?.();
    });

    expect(mocks.supabaseFrom).toHaveBeenCalledWith('blog_posts');
    expect(mocks.deleteFn).toHaveBeenCalled();
    expect(eqId).toHaveBeenCalledWith(
      'id',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    );
    expect(eqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-abc-123');
    expect(mocks.routerBack).toHaveBeenCalled();
  });

  it('shows error alert and does not navigate on delete failure', async () => {
    blogPostTestSupport.setupSupabaseMocks({
      error: { message: 'RLS policy violation', code: '42501' },
    });

    await act(async () => {
      render(<BlogPostDetailScreen />);
    });

    await waitFor(() => {
      expect(screen.getByText('Delete Post')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Delete Post'));
    const deleteConfirm = blogPostTestSupport.getDeleteConfirmButton();
    mocks.alert.mockClear();
    mocks.routerBack.mockClear();

    await act(async () => {
      await deleteConfirm?.onPress?.();
    });

    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Failed to delete blog post. Please try again.'
    );
    expect(mocks.routerBack).not.toHaveBeenCalled();
  });

  it('publishes the current draft from an explicit publish button', async () => {
    const { updateEqId, updateEqMerchant } =
      blogPostTestSupport.setupSupabaseMocks({
        error: null,
      });

    await act(async () => {
      render(<BlogPostDetailScreen />);
    });

    await waitFor(() => {
      expect(screen.getByText('Publish Article')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Publish Article'));
    });

    await waitFor(() => {
      expect(mocks.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'published',
          published_at: expect.any(String),
        })
      );
    });
    expect(updateEqId).toHaveBeenCalledWith(
      'id',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    );
    expect(updateEqMerchant).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-abc-123'
    );
    expect(mocks.routerBack).toHaveBeenCalled();
  });

  it('opens the native article preview instead of showing the placeholder alert', async () => {
    blogPostTestSupport.setupSupabaseMocks({ error: null });

    await act(async () => {
      render(<BlogPostDetailScreen />);
    });

    await waitFor(() => {
      expect(screen.getByText('Preview Article')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Preview Article'));

    expect(mocks.routerPush).toHaveBeenCalledWith({
      pathname: '/blog/preview',
      params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    });
    expect(mocks.alert).not.toHaveBeenCalledWith(
      'Preview',
      expect.stringContaining('coming soon')
    );
  });
});
