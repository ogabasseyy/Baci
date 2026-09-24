import { isQuizAudioAvailable } from './is-quiz-audio-available';
import type { QuizMusicPlaybackState } from './QuizMusicPlayerNative';

interface QuizMusicPlayerProps {
  gameEndsIn?: string;
  initialIsPlaying?: boolean;
  initialTrackIndex?: number;
  onPlaybackChange?: (playback: QuizMusicPlaybackState) => void;
}

export function QuizMusicPlayer({
  gameEndsIn,
  initialIsPlaying,
  initialTrackIndex,
  onPlaybackChange,
}: QuizMusicPlayerProps) {
  if (!isQuizAudioAvailable()) return null;

  const { QuizMusicPlayerNative } =
    require('./QuizMusicPlayerNative') as typeof import('./QuizMusicPlayerNative');
  return (
    <QuizMusicPlayerNative
      gameEndsIn={gameEndsIn}
      initialIsPlaying={initialIsPlaying}
      initialTrackIndex={initialTrackIndex}
      onPlaybackChange={onPlaybackChange}
    />
  );
}
