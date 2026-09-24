import { ScrollView } from 'react-native';
import type { QuizResult } from '@/services/quiz';
import type { QuizV2Result } from '@/services/quiz-types';
import type {
  QuizTerminalContext,
  QuizV2LifecycleStatus,
} from '@/stores/quiz-recovery-envelope';
import { QuizMusicPlayer } from './QuizMusicPlayer';
import type { QuizMusicPlaybackState } from './QuizMusicPlayerNative';
import { QuizResultsPanel } from './QuizResultsPanel';
import type { createQuizStyles } from './QuizScreen.styles';

interface QuizResultsSectionProps {
  expectedUserId: string | null;
  legacyResult: QuizResult | null;
  lifecycle: QuizV2LifecycleStatus;
  music: { gameEndsIn: string; shouldPlay: boolean };
  musicPlayerPlayback: {
    initialPlayback: QuizMusicPlaybackState;
    onPlaybackChange: (playback: QuizMusicPlaybackState) => void;
  };
  styles: ReturnType<typeof createQuizStyles>;
  terminalContext: QuizTerminalContext | null;
  v2Result: QuizV2Result | null;
}

export function QuizResultsSection({
  expectedUserId,
  legacyResult,
  lifecycle,
  music,
  musicPlayerPlayback,
  styles,
  terminalContext,
  v2Result,
}: QuizResultsSectionProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      style={styles.gameplayScroll}
    >
      {music.shouldPlay ? (
        <QuizMusicPlayer
          gameEndsIn={music.gameEndsIn}
          {...musicPlayerPlayback}
        />
      ) : null}
      <QuizResultsPanel
        eventId={terminalContext?.eventId}
        eventEndsAt={terminalContext?.eventEndsAt}
        expectedUserId={expectedUserId}
        legacyResult={legacyResult}
        lifecycle={lifecycle}
        serverNow={terminalContext?.serverNow}
        styles={styles}
        v2Result={v2Result}
      />
    </ScrollView>
  );
}
