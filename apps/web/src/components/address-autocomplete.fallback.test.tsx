import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getPlaceDetails, getPlacePredictions } from '@/lib/google-places';
import { AddressAutocomplete } from './address-autocomplete';

vi.mock('@/lib/google-places', () => ({
  generateSessionToken: () => 'session',
  getPlacePredictions: vi.fn(),
  getPlaceDetails: vi.fn(),
}));
const geo = {
  provider: 'geoapify' as const,
  placeId: 'geoapify:id',
  mainText: '20 Allen Avenue',
  secondaryText: 'Ikeja, Lagos',
  fullText: '20 Allen Avenue, Ikeja, Lagos',
  details: {
    placeId: 'geoapify:id',
    formattedAddress: '20 Allen Avenue, Ikeja, Lagos',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    location: { latitude: 6.6, longitude: 3.3 },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
async function search(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

it('selects Geoapify details and keeps its attribution after the dropdown closes', async () => {
  vi.mocked(getPlacePredictions).mockResolvedValue([geo]);
  const onSelect = vi.fn();
  render(
    <AddressAutocomplete
      aria-label="Address"
      country="NG"
      onSelect={onSelect}
    />
  );
  await search(
    screen.getByRole('textbox', { name: 'Address' }),
    'Allen Avenue'
  );
  expect(screen.getByRole('link', { name: 'Geoapify' })).toHaveAttribute(
    'href',
    'https://www.geoapify.com/'
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /20 Allen Avenue/ }))
  );
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({
      city: 'Ikeja',
      state: 'Lagos',
      location: geo.details.location,
    })
  );
  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(
    screen.getAllByRole('link', { name: /OpenStreetMap/ }).at(-1)
  ).toBeVisible();
});
it('keeps manual text editable when both providers fail and clears the error after recovery', async () => {
  vi.mocked(getPlacePredictions)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce([geo]);
  const onChange = vi.fn();
  const onError = vi.fn();
  render(
    <AddressAutocomplete
      aria-label="Address"
      onChange={onChange}
      onError={onError}
    />
  );
  const input = screen.getByRole('textbox', { name: 'Address' });
  await search(input, '20 Allen Avenue, Ikeja, Lagos');
  expect(input).toHaveValue('20 Allen Avenue, Ikeja, Lagos');
  expect(screen.getByRole('status')).toHaveTextContent(/manually/);
  expect(onError).toHaveBeenLastCalledWith(true);
  await search(input, '20 Allen Avenue');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(onError).toHaveBeenLastCalledWith(false);
});
it('clearing an input cancels its debounced provider call', async () => {
  render(<AddressAutocomplete aria-label="Address" />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Allen Avenue' },
  });
  // The loading indicator replaces the clear button; clearing by text edit
  // must still invalidate the pending debounce.
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(getPlacePredictions).not.toHaveBeenCalled();
});
