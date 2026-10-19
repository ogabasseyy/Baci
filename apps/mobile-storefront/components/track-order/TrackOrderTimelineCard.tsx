import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';

type TrackOrderTimelineIcon =
  | 'order'
  | 'payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

interface TrackOrderTimelineEvent {
  status: string;
  title: string;
  description: string;
  timestamp: string;
  icon: TrackOrderTimelineIcon;
}

interface TrackOrderTimelineCardColors {
  border: string;
  card: string;
  text: string;
  textSecondary: string;
}

interface TrackOrderTimelineCardProps {
  colors: TrackOrderTimelineCardColors;
  timeline: TrackOrderTimelineEvent[];
}

const TIMELINE_ICONS: Record<TrackOrderTimelineIcon, IoniconsIconName> = {
  order: 'receipt-outline',
  payment: 'card-outline',
  processing: 'cog-outline',
  shipped: 'airplane-outline',
  delivered: 'checkmark-circle-outline',
  cancelled: 'close-circle-outline',
  returned: 'return-down-back-outline',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#10B981',
  current: BRAND.primary,
  pending: '#9CA3AF',
  failed: '#EF4444',
};

function formatTimelineDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TrackOrderTimelineCard({
  colors,
  timeline,
}: TrackOrderTimelineCardProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Order Timeline
      </Text>
      {timeline.map((event, index) => {
        const isLast = index === timeline.length - 1;
        const eventColor = STATUS_COLORS[event.status] || STATUS_COLORS.pending;

        return (
          <View
            key={`${event.timestamp}-${event.status}`}
            style={styles.timelineItem}
          >
            <View style={styles.timelineLeft}>
              <View
                style={[styles.timelineDot, { backgroundColor: eventColor }]}
              >
                <Ionicons
                  name={TIMELINE_ICONS[event.icon] || 'ellipse'}
                  size={14}
                  color="#FFFFFF"
                />
              </View>
              {!isLast ? (
                <View
                  style={[
                    styles.timelineLine,
                    {
                      backgroundColor:
                        event.status === 'completed'
                          ? STATUS_COLORS.completed
                          : colors.border,
                    },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.timelineContent}>
              <Text style={[styles.timelineTitle, { color: colors.text }]}>
                {event.title}
              </Text>
              <Text
                style={[styles.timelineDesc, { color: colors.textSecondary }]}
              >
                {event.description}
              </Text>
              {event.timestamp ? (
                <Text
                  style={[styles.timelineTime, { color: colors.textSecondary }]}
                >
                  {formatTimelineDateTime(event.timestamp)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 16,
    paddingLeft: 12,
  },
  timelineDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  timelineDot: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  timelineItem: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 32,
  },
  timelineLine: {
    flex: 1,
    marginVertical: 4,
    width: 2,
  },
  timelineTime: {
    fontSize: 11,
    marginTop: 4,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
});
