import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('./is-quiz-audio-available', () => ({
  isQuizAudioAvailable: () => false,
}));

jest.mock('expo-audio', () => {
  throw new Error('Cannot find native module ExpoAudio');
});

describe('QuizMusicPlayer dev-build compatibility', () => {
  it('does not load expo-audio when the installed client lacks ExpoAudio', () => {
    expect(() => {
      const { QuizMusicPlayer } =
        require('./QuizMusicPlayer') as typeof import('./QuizMusicPlayer');
      render(React.createElement(QuizMusicPlayer));
    }).not.toThrow();
  });
});
