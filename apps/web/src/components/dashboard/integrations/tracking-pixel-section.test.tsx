import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { TrackingPixelSection } from './tracking-pixel-section';

it('keeps saved credentials blank, rotates then clears drafts, and explicitly disconnects', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  render(
    <TrackingPixelSection
      platform="Meta"
      pixelId="pixel"
      pixelLabel="Pixel"
      tokenLabel="CAPI Token"
      tokenConfigured
      onSave={save}
      onDisconnect={disconnect}
    />
  );
  const input = screen.getByLabelText('CAPI Token');
  expect(input).toHaveValue('');
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(save).toHaveBeenCalledWith('pixel', ''));
  await waitFor(() =>
    expect(screen.getByText('Save Changes')).not.toBeDisabled()
  );
  fireEvent.change(input, { target: { value: 'replacement' } });
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith('pixel', 'replacement')
  );
  await waitFor(() => expect(input).toHaveValue(''));
  fireEvent.click(screen.getByText('Disconnect server tracking'));
  await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
});
