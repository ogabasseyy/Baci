import { fireEvent, render, screen } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('img', { name: 'pending.webp' }));
  expect(onSelect).not.toHaveBeenCalled();
});
