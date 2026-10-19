import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredCheckoutAuthModal } from './DeferredCheckoutAuthModal';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {} }) }));

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(<DeferredCheckoutAuthModal isOpen onOpenChange={onClose} onSuccess={vi.fn()} />);

  expect(await screen.findByRole('button', { name: 'Sign In' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /close/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
