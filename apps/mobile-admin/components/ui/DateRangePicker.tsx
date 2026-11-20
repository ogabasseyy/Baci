import Ionicons from '@react-native-vector-icons/ionicons';
import { addMonths, subMonths } from 'date-fns';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { DateRangePickerCalendarPanel } from '@/components/ui/date-range-picker/DateRangePickerCalendarPanel';
import { DateRangePickerPresetPanel } from '@/components/ui/date-range-picker/DateRangePickerPresetPanel';
import { dateRangePickerHelpers } from '@/components/ui/date-range-picker/dateRangePickerHelpers';
import styles from '@/components/ui/date-range-picker/dateRangePickerStyles';
import type { DateRangeSelection } from '@/components/ui/date-range-picker/dateRangePickerTypes';
import { ModalSafeArea } from '@/components/ui/ModalSafeArea';
import { useTheme } from '@/hooks/useTheme';

interface DateRangePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (range: string | DateRangeSelection | null) => void;
  currentFilter: string | DateRangeSelection | null;
}

export default function DateRangePicker({
  visible,
  onClose,
  onSelect,
  currentFilter,
}: DateRangePickerProps) {
  const { colors, shadows } = useTheme();

  // State
  const [mode, setMode] = useState<'presets' | 'calendar'>('presets');
  const [viewDate, setViewDate] = useState(new Date());
  const [selection, setSelection] = useState<DateRangeSelection>({
    start: null,
    end: null,
  });

  // Initialize state when opening. Adjusted during render (instead of in an
  // effect) so the first visible frame already reflects the incoming filter.
  const [prevVisible, setPrevVisible] = useState(false);
  const [prevFilter, setPrevFilter] = useState<
    string | DateRangeSelection | null
  >(null);

  if (visible !== prevVisible || currentFilter !== prevFilter) {
    setPrevVisible(visible);
    setPrevFilter(currentFilter);
    if (visible) {
      if (typeof currentFilter === 'object' && currentFilter?.start) {
        setMode('calendar');
        setSelection(currentFilter);
        setViewDate(currentFilter.start);
      } else {
        setMode('presets');
        setSelection({ start: null, end: null });
        setViewDate(new Date());
      }
    }
  }

  const handleDayPress = (day: Date) => {
    setSelection(
      dateRangePickerHelpers.getNextDateRangeSelection(selection, day)
    );
  };

  const activePreset = typeof currentFilter === 'string' ? currentFilter : null;

  return (
    <Modal
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape']}
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <ModalSafeArea
        backdropColor={colors.backdrop}
        onBackdropPress={onClose}
        style={styles.overlay}
      >
        <Pressable
          style={[
            styles.container,
            { backgroundColor: colors.card, maxHeight: '80%' },
            shadows.lg,
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              Select Date Range
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close date picker"
              accessibilityHint="Closes the date picker modal"
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Mode Switcher */}
          <View
            style={[
              styles.modeSwitcher,
              { backgroundColor: colors.background },
            ]}
          >
            <Pressable
              style={[
                styles.modeButton,
                mode === 'presets' && {
                  backgroundColor: colors.card,
                  ...shadows.sm,
                },
              ]}
              onPress={() => setMode('presets')}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'presets' }}
            >
              <Text
                style={[
                  styles.modeText,
                  {
                    color: mode === 'presets' ? colors.text : colors.textMuted,
                  },
                ]}
              >
                Presets
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.modeButton,
                mode === 'calendar' && {
                  backgroundColor: colors.card,
                  ...shadows.sm,
                },
              ]}
              onPress={() => setMode('calendar')}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'calendar' }}
            >
              <Text
                style={[
                  styles.modeText,
                  {
                    color: mode === 'calendar' ? colors.text : colors.textMuted,
                  },
                ]}
              >
                Custom
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.content}>
            {mode === 'presets' ? (
              <DateRangePickerPresetPanel
                activePreset={activePreset}
                onClear={() => {
                  onSelect(null);
                  onClose();
                }}
                onSelectPreset={(preset) => {
                  onSelect(preset);
                  onClose();
                }}
              />
            ) : (
              <DateRangePickerCalendarPanel
                onApply={() => {
                  if (selection.start && selection.end) {
                    onSelect(selection);
                    onClose();
                  }
                }}
                onSelectDay={handleDayPress}
                onViewNextMonth={() => setViewDate(addMonths(viewDate, 1))}
                onViewPreviousMonth={() => setViewDate(subMonths(viewDate, 1))}
                selection={selection}
                viewDate={viewDate}
              />
            )}
          </ScrollView>
        </Pressable>
      </ModalSafeArea>
    </Modal>
  );
}
