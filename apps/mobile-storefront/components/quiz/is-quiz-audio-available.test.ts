import { describe, expect, it, jest } from '@jest/globals';
import { isQuizAudioAvailable } from './is-quiz-audio-available';

describe('isQuizAudioAvailable', () => {
  it('returns false when the installed client lacks ExpoAudio', () => {
    const loadNativeModule = jest.fn(() => null);

    expect(isQuizAudioAvailable(loadNativeModule)).toBe(false);
    expect(loadNativeModule).toHaveBeenCalledWith('ExpoAudio');
  });

  it('returns true when the installed client includes ExpoAudio', () => {
    const loadNativeModule = jest.fn(() => ({}));

    expect(isQuizAudioAvailable(loadNativeModule)).toBe(true);
  });
});
