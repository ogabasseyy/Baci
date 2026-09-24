import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  setAudioModeAsync,
  useAudioPlaylist,
  useAudioPlaylistStatus,
} from 'expo-audio';
import { QuizMusicPlayerNative } from './QuizMusicPlayerNative';

let mockTrackChanged:
  | ((data: { currentIndex: number; previousIndex: number }) => void)
  | undefined;
const mockPlaylist = {
  addListener: jest.fn(
    (
      _event: string,
      listener: (data: { currentIndex: number; previousIndex: number }) => void
    ) => {
      mockTrackChanged = listener;
      return { remove: jest.fn() };
    }
  ),
  muted: false,
  pause: jest.fn(),
  play: jest.fn(),
  volume: 1,
};

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioPlaylist: jest.fn(),
  useAudioPlaylistStatus: jest.fn(),
}));

const mockSetAudioModeAsync = jest.mocked(setAudioModeAsync);
const mockUseAudioPlaylist = jest.mocked(useAudioPlaylist);
const mockUseAudioPlaylistStatus = jest.mocked(useAudioPlaylistStatus);

describe('QuizMusicPlayerNative', () => {
  beforeEach(() => {
    mockPlaylist.muted = false;
    mockPlaylist.volume = 1;
    mockPlaylist.addListener.mockClear();
    mockPlaylist.pause.mockClear();
    mockPlaylist.play.mockClear();
    mockTrackChanged = undefined;
    mockSetAudioModeAsync.mockClear();
    mockUseAudioPlaylist.mockClear();
    mockUseAudioPlaylist.mockReturnValue(mockPlaylist as never);
    mockUseAudioPlaylistStatus.mockReset();
    mockUseAudioPlaylistStatus.mockReturnValue({
      currentTime: 0,
      duration: 0,
    } as never);
  });

  it('starts the two Ogabassey tracks in the approved order at low volume', async () => {
    const { unmount } = render(<QuizMusicPlayerNative />);

    expect(screen.getByText('Nobody does it better')).toBeTruthy();
    expect(mockUseAudioPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        loop: 'all',
        sources: expect.any(Array),
        updateInterval: 10_000,
      })
    );
    expect(mockUseAudioPlaylist.mock.calls[0]?.[0]?.sources).toHaveLength(2);
    expect(mockPlaylist.volume).toBe(0.16);
    await waitFor(() =>
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          interruptionMode: 'duckOthers',
          playsInSilentMode: true,
        })
      )
    );
    await waitFor(() => expect(mockPlaylist.play).toHaveBeenCalledTimes(1));

    act(() => mockTrackChanged?.({ currentIndex: 1, previousIndex: 0 }));
    expect(screen.getByText('Ogabassey No dey Disappoint 1')).toBeTruthy();

    unmount();
    expect(mockPlaylist.pause).toHaveBeenCalled();
  });

  it('lets the player mute and restore quiz music', async () => {
    render(<QuizMusicPlayerNative />);

    fireEvent.press(screen.getByRole('button', { name: 'Pause quiz music' }));
    await waitFor(() => expect(mockPlaylist.pause).toHaveBeenCalled());

    fireEvent.press(screen.getByRole('button', { name: 'Play quiz music' }));
    await waitFor(() => expect(mockPlaylist.play).toHaveBeenCalled());
  });

  it('does not crash when iOS releases the native playlist before cleanup', () => {
    mockPlaylist.pause.mockImplementationOnce(() => {
      throw new Error('Unable to find the native shared object');
    });
    const { unmount } = render(<QuizMusicPlayerNative />);

    expect(() => unmount()).not.toThrow();
  });

  it('shows the game deadline and compact playback line together', () => {
    render(<QuizMusicPlayerNative gameEndsIn="1:09" />);

    expect(screen.getByText('Ends in')).toBeTruthy();
    expect(screen.getByText('1:09')).toBeTruthy();
    expect(screen.getByLabelText('Game deadline')).toBeTruthy();
    expect(screen.getByLabelText('Music playback progress')).toBeTruthy();
    expect(
      screen.getByLabelText('Now playing Nobody does it better')
    ).toBeTruthy();
  });

  it('drives playback progress from the playlist status', () => {
    mockUseAudioPlaylistStatus.mockReturnValue({
      currentTime: 25,
      duration: 100,
    } as never);
    render(<QuizMusicPlayerNative />);

    const progress = screen.getByLabelText('Music playback progress');
    expect(progress.props.accessibilityValue).toMatchObject({
      max: 100,
      min: 0,
      now: 25,
    });
    expect(progress.props.children.props.style).toEqual(
      expect.arrayContaining([{ width: '25%' }])
    );
  });
});
