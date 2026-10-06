import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import type { FetchImplementation } from '@/types/fetch';
import { AddressAutocomplete } from './AddressAutocomplete';
import { clearPredictionCache } from './AddressAutocomplete.api';
import { AddressSuggestionsProvider } from './address-suggestions-portal';

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'http://localhost:3000' } } },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('test-session-token'),
}));

const TEST_PREDICTION = {
  placeId: 'place-1',
  mainText: '123 Main Street',
  secondaryText: 'Lagos, Nigeria',
  description: '123 Main Street, Lagos, Nigeria',
};
const fetchMock = jest.fn<FetchImplementation>();

const TEST_DETAILS_RESPONSE = {
  details: {
    streetNumber: '123',
    route: 'Main Street',
    city: 'Lagos',
    state: 'Lagos',
    postalCode: '100001',
    country: 'Nigeria',
    formattedAddress: '123 Main Street, Lagos, Nigeria',
  },
};

function mockPredictionsSuccess() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ predictions: [TEST_PREDICTION] }),
    text: async () => '',
  } as Response);
}

function mockDetailsSuccess() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => TEST_DETAILS_RESPONSE,
    text: async () => '',
  } as Response);
}

function renderField(ui: React.ReactElement) {
  return render(<AddressSuggestionsProvider>{ui}</AddressSuggestionsProvider>);
}

async function focusTypeAndWait(text = 'Lagos') {
  const input = screen.getByRole('combobox');
  fireEvent(input, 'focus');
  fireEvent.changeText(input, text);
  await act(async () => {
    jest.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
  return input;
}

type MeasureFn = (
  cb: (x: number, y: number, w: number, h: number) => void
) => void;
let measureSpy: jest.SpiedFunction<MeasureFn>;

describe('AddressAutocomplete (portal dropdown)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    // The predictions API keeps a module-level cache; clear it so each test's
    // queued fetch mocks are consumed by the calls they were queued for.
    clearPredictionCache();
    // The portal anchors at the field's measured window rect; the test
    // renderer's measureInWindow is a no-op, so report a plausible rect.
    measureSpy = jest
      .spyOn(
        View.prototype as unknown as { measureInWindow: MeasureFn },
        'measureInWindow'
      )
      .mockImplementation((cb) => cb(16, 200, 343, 52));
  });

  afterEach(() => {
    measureSpy.mockRestore();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('renders the inline input with the placeholder', () => {
    renderField(<AddressAutocomplete />);

    expect(
      screen.getByPlaceholderText('Start typing your address...')
    ).toBeTruthy();
  });

  it('shows suggestions in the floating dropdown after typing while focused', async () => {
    mockPredictionsSuccess();
    renderField(<AddressAutocomplete />);

    await focusTypeAndWait();

    expect(screen.getByText(TEST_PREDICTION.mainText)).toBeTruthy();
    expect(screen.getByText(TEST_PREDICTION.secondaryText)).toBeTruthy();
  });

  it('clears visible suggestions immediately when the query changes', async () => {
    mockPredictionsSuccess();
    renderField(<AddressAutocomplete />);
    const input = await focusTypeAndWait('Allen');

    fireEvent.changeText(input, 'Banana Island');

    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
  });

  it('ignores an older prediction response after a newer query resolves', async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveOld = resolve))
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [
            { ...TEST_PREDICTION, mainText: 'Banana Island', placeId: 'new' },
          ],
        }),
        text: async () => '',
      } as Response);
    renderField(<AddressAutocomplete />);
    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Allen');
    act(() => jest.advanceTimersByTime(300));
    fireEvent.changeText(input, 'Banana');
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Banana Island')).toBeTruthy();

    await act(async () => {
      resolveOld?.({
        ok: true,
        json: async () => ({ predictions: [TEST_PREDICTION] }),
        text: async () => '',
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
    expect(screen.getByText('Banana Island')).toBeTruthy();
  });

  it('clears loading and ignores results when the query is cleared in flight', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveRequest = resolve))
    );
    renderField(<AddressAutocomplete />);
    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Allen');
    await act(async () => jest.advanceTimersByTime(300));
    expect(screen.getByLabelText('Loading address suggestions')).toBeTruthy();

    fireEvent.changeText(input, '');
    await act(async () => {
      resolveRequest?.({
        ok: true,
        json: async () => ({ predictions: [TEST_PREDICTION] }),
        text: async () => '',
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByLabelText('Loading address suggestions')).toBeNull();
    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
  }, 30_000);

  it('does not reopen suggestions from a measurement completed after blur', async () => {
    let finishMeasurement:
      | (MeasureFn extends (cb: infer C) => void ? C : never)
      | undefined;
    measureSpy.mockImplementation((cb) => {
      finishMeasurement = cb;
    });
    mockPredictionsSuccess();
    renderField(<AddressAutocomplete />);
    const input = await focusTypeAndWait();

    fireEvent(input, 'blur');
    act(() => finishMeasurement?.(16, 200, 343, 52));

    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
  });

  it('keeps free text committed as the user types (no selection required)', async () => {
    const onChangeText = jest.fn();
    renderField(<AddressAutocomplete onChangeText={onChangeText} />);

    const input = screen.getByRole('combobox');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'Off-grid address 5');

    expect(onChangeText).toHaveBeenCalledWith('Off-grid address 5');
  });

  it('commits a prediction on a single tap: writes text, fetches details, hides list', async () => {
    mockPredictionsSuccess();
    mockDetailsSuccess();
    const onChangeText = jest.fn();
    const onSelect = jest.fn();
    renderField(
      <AddressAutocomplete onChangeText={onChangeText} onSelect={onSelect} />
    );

    await focusTypeAndWait();
    fireEvent.press(
      screen.getByRole('button', {
        name: `${TEST_PREDICTION.mainText}, ${TEST_PREDICTION.secondaryText}`,
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onChangeText).toHaveBeenCalledWith(TEST_PREDICTION.mainText);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Lagos', route: 'Main Street' })
    );
    expect(screen.queryByText(TEST_PREDICTION.secondaryText)).toBeNull();
  });

  it('hides the dropdown when the field blurs', async () => {
    mockPredictionsSuccess();
    renderField(<AddressAutocomplete />);

    const input = await focusTypeAndWait();
    expect(screen.getByText(TEST_PREDICTION.mainText)).toBeTruthy();

    fireEvent(input, 'blur');

    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
  });

  it('clears the value and suggestions from the clear button', async () => {
    mockPredictionsSuccess();
    const onChangeText = jest.fn();
    renderField(<AddressAutocomplete onChangeText={onChangeText} />);

    await focusTypeAndWait();
    fireEvent.press(screen.getByRole('button', { name: 'Clear address' }));

    expect(onChangeText).toHaveBeenCalledWith('');
    expect(screen.queryByText(TEST_PREDICTION.mainText)).toBeNull();
  });

  it('renders the error message', () => {
    renderField(<AddressAutocomplete error="Address is required" />);

    expect(screen.getByText('Address is required')).toBeTruthy();
  });
});
