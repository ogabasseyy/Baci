import Ionicons from '@react-native-vector-icons/ionicons';
import {
  setAudioModeAsync,
  useAudioPlaylist,
  useAudioPlaylistStatus,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import nobodyDoesItBetter from '@/assets/quiz/audio/nobody-does-it-better.mp3';
import noDeyDisappointPartOne from '@/assets/quiz/audio/ogabassey-no-dey-disappoint-1.mp3';
import { useTheme } from '@/hooks/useTheme';

const QUIZ_MUSIC_VOLUME = 0.16;
const QUIZ_TRACKS = [
  { source: nobodyDoesItBetter, title: 'Nobody does it better' },
  {
    source: noDeyDisappointPartOne,
    title: 'Ogabassey No dey Disappoint 1',
  },
] as const;

interface QuizMusicPlayerNativeProps {
  gameEndsIn?: string;
}

function safelyControlPlaylist(control: () => void) {
  try {
    control();
  } catch {
    // Expo Audio can release the native shared object before React cleanup.
  }
}

export function QuizMusicPlayerNative({
  gameEndsIn,
}: QuizMusicPlayerNativeProps) {
  const { colors } = useTheme();
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const playlist = useAudioPlaylist({
    loop: 'all',
    sources: QUIZ_TRACKS.map((track) => track.source),
    updateInterval: 10_000,
  });
  const currentTrack = QUIZ_TRACKS[currentTrackIndex] ?? QUIZ_TRACKS[0];
  const status = useAudioPlaylistStatus(playlist);
  const progress =
    status.duration > 0
      ? Math.min(1, Math.max(0, status.currentTime / status.duration))
      : 0;
  const styles = createStyles(colors);

  useEffect(() => {
    const subscription = playlist.addListener(
      'trackChanged',
      ({ currentIndex }) => setCurrentTrackIndex(currentIndex)
    );
    return () => subscription.remove();
  }, [playlist]);

  useEffect(() => {
    let cancelled = false;
    playlist.volume = QUIZ_MUSIC_VOLUME;

    void setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'duckOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    })
      .then(() => {
        if (!cancelled) safelyControlPlaylist(() => playlist.play());
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      safelyControlPlaylist(() => playlist.pause());
    };
  }, [playlist]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isPlaying) {
        safelyControlPlaylist(() => playlist.play());
        return;
      }
      safelyControlPlaylist(() => playlist.pause());
    });
    return () => subscription.remove();
  }, [isPlaying, playlist]);

  return (
    <View accessibilityLabel="Quiz music" style={styles.musicBar}>
      <View style={styles.topRow}>
        {gameEndsIn ? (
          <View accessibilityLabel="Game deadline" style={styles.deadlinePill}>
            <Ionicons
              color={colors.primary}
              name="hourglass-outline"
              size={14}
            />
            <Text style={styles.deadlineLabel}>Ends in</Text>
            <Text style={styles.deadline}>{gameEndsIn}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityLabel={
            isPlaying ? 'Pause quiz music' : 'Play quiz music'
          }
          accessibilityRole="button"
          accessibilityState={{ selected: isPlaying }}
          hitSlop={8}
          onPress={() => {
            if (isPlaying) safelyControlPlaylist(() => playlist.pause());
            else safelyControlPlaylist(() => playlist.play());
            setIsPlaying(!isPlaying);
          }}
          style={styles.playButton}
        >
          <Ionicons
            color={colors.text}
            name={isPlaying ? 'pause' : 'play'}
            size={18}
          />
        </Pressable>
      </View>
      <View
        accessibilityLabel={`Now playing ${currentTrack.title}`}
        style={styles.musicCopy}
      >
        <Ionicons color={colors.primary} name="musical-note" size={15} />
        <Text numberOfLines={1} style={styles.musicTitle}>
          {currentTrack.title}
        </Text>
      </View>
      <View
        accessibilityLabel="Music playback progress"
        accessibilityRole="progressbar"
        accessibilityValue={{
          max: 100,
          min: 0,
          now: Math.round(progress * 100),
        }}
        style={styles.playbackTrack}
      >
        <View style={[styles.playbackFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    musicBar: {
      gap: 8,
      paddingVertical: 4,
    },
    topRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    musicCopy: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 2,
    },
    deadlinePill: {
      alignItems: 'center',
      backgroundColor: colors.primaryLowOpacity,
      borderColor: colors.primary,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    deadlineLabel: {
      color: colors.textSecondary,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
    },
    deadline: {
      color: colors.primary,
      fontFamily: 'Inter_700Bold',
      fontSize: 13,
      fontVariant: ['tabular-nums'],
    },
    musicTitle: {
      color: colors.text,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      flexShrink: 1,
    },
    playButton: {
      alignItems: 'center',
      backgroundColor: colors.primaryLowOpacity,
      borderRadius: 999,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    playbackTrack: {
      backgroundColor: colors.border,
      borderRadius: 999,
      height: 3,
      overflow: 'hidden',
    },
    playbackFill: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      height: '100%',
    },
  });
}
