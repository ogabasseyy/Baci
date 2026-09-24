import { isQuizAudioAvailable } from './is-quiz-audio-available';
import type { QuizMusicPlaybackState } from './QuizMusicPlayerNative';

interface QuizMusicPlayerProps {
  gameEndsIn?: string;
  initialPlayback?: QuizMusicPlaybackState;
  onPlaybackChange?: (playback: QuizMusicPlaybackState) => void;
}

export function QuizMusicPlayer({
  gameEndsIn,
  initialPlayback,
  onPlaybackChange,
}: QuizMusicPlayerProps) {
  if (!isQuizAudioAvailable()) return null;

  const { QuizMusicPlayerNative } =
    require('./QuizMusicPlayerNative') as typeof import('./QuizMusicPlayerNative');
  return (
    <QuizMusicPlayerNative
      gameEndsIn={gameEndsIn}
      initialPlayback={initialPlayback}
      onPlaybackChange={onPlaybackChange}
    />
  );
}
