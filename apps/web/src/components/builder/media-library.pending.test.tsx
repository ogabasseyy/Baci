import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { MediaLibrary } from './media-library';

afterEach(() => vi.unstubAllGlobals());
it('labels pending removal and prevents attaching that image', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'asset',
              name: 'pending.webp',
              url: '/pending.webp',
              size: 100,
              type: 'image/webp',
              createdAt: '2026-11-01',
              deletionState: 'pending',
            },
            {
              id: 'active',
              name: 'active.webp',
              url: '/active.webp',
              size: 100,
              type: 'image/webp',
              createdAt: '2026-11-01',
              deletionState: 'active',
            },
          ],
        })
      )
    )
  );
  const onSelect = vi.fn();
  render(<MediaLibrary onSelect={onSelect} />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Deletion pending'
  );
  const pendingCard = screen
    .getByRole('img', { name: 'pending.webp' })
    .closest<HTMLElement>('.group');
  const activeCard = screen
    .getByRole('img', { name: 'active.webp' })
    .closest<HTMLElement>('.group');
  if (!pendingCard || !activeCard) throw new Error('Media cards not found');
  expect(
    within(pendingCard).queryByRole('button', {
      name: 'Copy URL',
    })
  ).not.toBeInTheDocument();
  expect(
    within(activeCard).getByRole('button', { name: 'Copy URL' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Delete pending.webp' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('img', { name: 'pending.webp' }));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('img', { name: 'active.webp' }));
  expect(onSelect).toHaveBeenCalledWith('/active.webp');
});
