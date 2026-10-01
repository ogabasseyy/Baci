import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { AddressAutocomplete } from './AddressAutocomplete';
import { clearPredictionCache } from './AddressAutocomplete.api';
import { AddressSuggestionsProvider } from './address-suggestions-portal';

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'http://localhost:3000' } } },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('test-session-token'),
}));

const prediction = {
  description: '1 Allen Avenue, Ikeja, Lagos',
  mainText: '1 Allen Avenue',
  placeId: 'place-1',
  secondaryText: 'Ikeja, Lagos',
};
const fetchMock = jest.fn<typeof fetch>();
type MeasureFn = (
  callback: (x: number, y: number, width: number, height: number) => void
) => void;

let measuredWidth = 343;
let measureSpy: jest.SpiedFunction<MeasureFn>;

function renderField() {
  return render(
    <AddressSuggestionsProvider>
      <AddressAutocomplete />
    </AddressSuggestionsProvider>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  clearPredictionCache();
  measuredWidth = 343;
  measureSpy = jest
    .spyOn(
      View.prototype as unknown as { measureInWindow: MeasureFn },
      'measureInWindow'
    )
    .mockImplementation((callback) => callback(16, 200, measuredWidth, 52));
});

afterEach(() => {
  measureSpy.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('AddressAutocomplete regressions', () => {
  it('keeps the measured anchor materialized for native layout', () => {
    renderField();

    expect(
      screen.getByTestId('address-autocomplete-anchor').props.collapsable
    ).toBe(false);
  });

  it('cancels the pending prediction request when cleared before debounce', () => {
    renderField();
    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Allen');

    fireEvent.press(screen.getByRole('button', { name: 'Clear address' }));
    act(() => jest.advanceTimersByTime(300));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Loading address suggestions')).toBeNull();
  });

  it('starts the prediction request within the responsive debounce window', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ predictions: [] }),
      text: async () => '',
    } as Response);
    renderField();
    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Allen');

    await act(async () => {
      jest.advanceTimersByTime(149);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the portal when the anchor width changes in place', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ predictions: [prediction] }),
      text: async () => '',
    } as Response);
    renderField();
    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Allen');
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      StyleSheet.flatten(
        screen.getByLabelText('Address suggestions').props.style
      ).width
    ).toBe(343);

    measuredWidth = 280;
    act(() => jest.advanceTimersByTime(120));

    expect(
      StyleSheet.flatten(
        screen.getByLabelText('Address suggestions').props.style
      ).width
    ).toBe(280);
  }, 30_000);
});
