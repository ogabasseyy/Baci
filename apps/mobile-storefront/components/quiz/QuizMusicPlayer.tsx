import { isQuizAudioAvailable } from './is-quiz-audio-available';

interface QuizMusicPlayerProps {
  gameEndsIn?: string;
}

export function QuizMusicPlayer({ gameEndsIn }: QuizMusicPlayerProps) {
  if (!isQuizAudioAvailable()) return null;

  const { QuizMusicPlayerNative } =
    require('./QuizMusicPlayerNative') as typeof import('./QuizMusicPlayerNative');
  return <QuizMusicPlayerNative gameEndsIn={gameEndsIn} />;
}
