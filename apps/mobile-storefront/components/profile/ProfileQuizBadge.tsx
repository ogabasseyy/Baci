import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';

interface ProfileQuizBadgeProps {
  eventTitle: string;
  label: string;
}

export function ProfileQuizBadge({ eventTitle, label }: ProfileQuizBadgeProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="ribbon" size={11} color={palette.amber[300]} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.event} numberOfLines={1}>
        {eventTitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    maxWidth: '100%',
  },
  event: {
    color: 'rgba(255,255,255,0.65)',
    flexShrink: 1,
    fontSize: 11,
  },
  label: {
    color: palette.amber[300],
    fontSize: 11,
    fontWeight: '800',
  },
});
