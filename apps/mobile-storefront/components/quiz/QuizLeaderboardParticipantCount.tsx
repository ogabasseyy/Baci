import { Text } from 'react-native';
import type { createQuizLeaderboardStyles } from './QuizLeaderboardScreen.styles';

interface QuizLeaderboardParticipantCountProps {
  count: number;
  styles: ReturnType<typeof createQuizLeaderboardStyles>;
}

export function QuizLeaderboardParticipantCount({
  count,
  styles,
}: QuizLeaderboardParticipantCountProps) {
  return (
    <Text style={styles.participantCount}>
      {count} {count === 1 ? 'participant' : 'participants'}
    </Text>
  );
}
