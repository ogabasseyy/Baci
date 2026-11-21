import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SwapScreen from '@/app/swap';

type PickerResult = {
  canceled: boolean;
  assets: { uri: string; type: string; width?: number; height?: number }[];
};

const mockLaunchImageLibraryAsync =
  jest.fn<(options: Record<string, unknown>) => Promise<PickerResult>>();
const mockAnalyzeSwapDevice = jest.fn<(media: unknown) => Promise<unknown>>();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted' }),
  requestCameraPermissionsAsync: async () => ({ status: 'granted' }),
  launchImageLibraryAsync: (options: Record<string, unknown>) =>
    mockLaunchImageLibraryAsync(options),
  launchCameraAsync: jest.fn(),
}));

jest.mock('@/lib/swap/analyze-swap-device', () => ({
  analyzeSwapDevice: (media: unknown) => mockAnalyzeSwapDevice(media),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    push: jest.fn(),
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

describe('SwapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the current swap overview content', () => {
    render(<SwapScreen />);

    expect(screen.getByText('Swap & Trade-in')).toBeOnTheScreen();
    expect(screen.getByText('How it Works')).toBeOnTheScreen();
    expect(screen.getByText('What can you trade in?')).toBeOnTheScreen();
    expect(screen.getByText('iPhones (11 and newer)')).toBeOnTheScreen();
  });

  it('opens the AI trade-in modal from the hero call-to-action', () => {
    render(<SwapScreen />);

    fireEvent.press(screen.getByText('Start AI Trade-in'));

    expect(screen.getByText('AI Trade-in Valuator')).toBeOnTheScreen();
    expect(screen.getByText('Analyze Device')).toBeOnTheScreen();
  });

  it('lets the shopper pick several photos and sends them for grading', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///front.jpg', type: 'image', width: 4032, height: 3024 },
        { uri: 'file:///back.jpg', type: 'image', width: 4032, height: 3024 },
      ],
    });
    mockAnalyzeSwapDevice.mockResolvedValue({
      ok: false,
      message: 'We could not identify this device.',
    });
    render(<SwapScreen />);
    fireEvent.press(screen.getByText('Start AI Trade-in'));

    fireEvent.press(screen.getByText('Select Photos or Video'));

    expect(await screen.findByText('2 photos selected')).toBeOnTheScreen();
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 6,
      })
    );

    fireEvent.press(screen.getByText('Analyze Device'));

    expect(
      await screen.findByText('We could not identify this device.')
    ).toBeOnTheScreen();
    expect(mockAnalyzeSwapDevice).toHaveBeenCalledWith({
      kind: 'photos',
      photos: [
        { uri: 'file:///front.jpg', width: 4032, height: 3024 },
        { uri: 'file:///back.jpg', width: 4032, height: 3024 },
      ],
    });
  });

  it('refuses photos mixed with a video and keeps nothing selected', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///front.jpg', type: 'image', width: 4032, height: 3024 },
        { uri: 'file:///device.mov', type: 'video' },
      ],
    });
    render(<SwapScreen />);
    fireEvent.press(screen.getByText('Start AI Trade-in'));

    fireEvent.press(screen.getByText('Select Photos or Video'));

    expect(
      await screen.findByText(
        'Please choose either one video or up to 6 photos, not both.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('Select Photos or Video')).toBeOnTheScreen();
    expect(mockAnalyzeSwapDevice).not.toHaveBeenCalled();
  });
});
