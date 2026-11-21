import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const stories = [
  {
    id: 'paycheck',
    quote: '“I got my first paycheck from my smartphone.”',
    artwork: require('@/assets/images/campaigns/first-paycheck.webp'),
    contentPosition: 'top',
  },
  {
    id: 'laptop',
    quote: '“Omoh, if not for this laptop, how I wan take chop?”',
    artwork: require('@/assets/images/campaigns/laptop-story-portrait.webp'),
    contentPosition: 'right center',
  },
  {
    id: 'repair',
    quote: '“I thought I needed a new phone. I just needed a new battery.”',
    artwork: require('@/assets/images/campaigns/repair-story.webp'),
    contentPosition: 'right top',
  },
  {
    id: 'savings',
    quote: '“Small small, I saved for the phone I wanted.”',
    artwork: require('@/assets/images/campaigns/savings-story.webp'),
    contentPosition: 'right top',
  },
] as const;

const GUTTER = 16;
const GAP = 10;

export function HomeImpactCarousel() {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 52, 420);

  return (
    <View style={styles.section}>
      <ScrollView
        horizontal
        accessibilityLabel="Ogabassey stories"
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + GAP}
        disableIntervalMomentum
        decelerationRate="fast"
        contentContainerStyle={[
          styles.track,
          { paddingRight: width - cardWidth - GUTTER },
        ]}
      >
        {stories.map((story) => (
          <View key={story.id} style={[styles.card, { width: cardWidth }]}>
            <Image
              accessible={false}
              source={story.artwork}
              contentFit="cover"
              contentPosition={story.contentPosition}
              style={[
                StyleSheet.absoluteFill,
                story.id === 'laptop' && styles.laptopArt,
              ]}
            />
            <LinearGradient
              pointerEvents="none"
              colors={['#21050c', '#21050c', 'transparent']}
              locations={[0, 0.72, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.scrim}
            />
            <Text style={styles.quote}>{story.quote}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 4, marginBottom: 4 },
  track: { paddingLeft: GUTTER, paddingBottom: 3, gap: GAP },
  card: {
    minHeight: 124,
    justifyContent: 'center',
    backgroundColor: '#21050c',
    borderColor: '#512331',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  laptopArt: { left: '52%' },
  scrim: { ...StyleSheet.absoluteFill, right: '36%' },
  quote: {
    width: '62%',
    padding: 12,
    color: '#fff',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
});
