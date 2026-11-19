import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import SafeImage from '@/components/ui/SafeImage';
import { getVirtualizedListProps } from '@/components/ui/virtualized-list-props';
import { isRuntimePlatform } from '@/config/runtime-platform';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import type { SelectableItem } from '@/lib/discount-items';
import { stripHtmlTags } from '@/lib/sanitize';
import { styles } from './DiscountItemSelector.styles';
import { loadSelectableItems } from './load-selectable-items';

interface DiscountItemSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (ids: string[]) => void;
  initialIds: string[];
  type: 'product' | 'category';
}

export function DiscountItemSelector({
  visible,
  onClose,
  onSelect,
  initialIds,
  type,
}: DiscountItemSelectorProps) {
  const { colors } = useTheme();
  const { merchant } = useMerchant();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SelectableItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialIds)
  );
  const [loading, setLoading] = useState(false);
  const [_fetchError, setFetchError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const [prevVisible, setPrevVisible] = useState(visible);
  const [prevInitialIds, setPrevInitialIds] = useState(initialIds);
  if (visible !== prevVisible || initialIds !== prevInitialIds) {
    setPrevVisible(visible);
    setPrevInitialIds(initialIds);
    if (visible) {
      setSelectedIds(new Set(initialIds));
      setSearch('');
    }
  }

  const handleFetchItems = (searchTerm: string) => {
    if (!merchant?.id) {
      requestIdRef.current += 1;
      setItems([]);
      setFetchError(null);
      setLoading(false);
      return;
    }

    void loadSelectableItems({
      merchantId: merchant.id,
      requestIdRef,
      search: searchTerm,
      setFetchError,
      setItems,
      setLoading,
      type,
    });
  };

  useEffect(() => {
    if (visible && merchant?.id) {
      void loadSelectableItems({
        merchantId: merchant.id,
        requestIdRef,
        search: '',
        setFetchError,
        setItems,
        setLoading,
        type,
      });
    } else if (visible) {
      // Merchant context vanished: invalidate any in-flight request and
      // settle the pending UI from a microtask (not synchronously in the
      // effect) so loading cannot stick at true.
      const requestId = ++requestIdRef.current;
      void Promise.resolve().then(() => {
        if (requestId !== requestIdRef.current) return;
        setItems([]);
        setFetchError(null);
        setLoading(false);
      });
    } else {
      // The sheet was closed: invalidate any in-flight request and settle
      // loading so the next open starts from a clean state.
      const requestId = ++requestIdRef.current;
      void Promise.resolve().then(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
    }

    return () => {
      requestIdRef.current += 1;
    };
  }, [visible, merchant?.id, type]);

  useEffect(() => {
    if (_fetchError && isRuntimePlatform('ios')) {
      AccessibilityInfo.announceForAccessibility(_fetchError);
    }
  }, [_fetchError]);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleSave = () => {
    onSelect(Array.from(selectedIds));
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <AppKeyboardContainer
          align="start"
          scrollEnabled={false}
          style={styles.container}
        >
          <SafeAreaView
            style={[styles.container, { backgroundColor: colors.background }]}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.7 },
                ]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close modal"
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
              <Text style={[styles.title, { color: colors.text }]}>
                Select {type === 'product' ? 'Products' : 'Categories'}
              </Text>
              <Pressable
                onPress={handleSave}
                style={({ pressed }) => [
                  styles.saveBtn,
                  pressed && { opacity: 0.7 },
                ]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={[styles.saveText, { color: colors.primary }]}>
                  Done
                </Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.searchContainer,
                { backgroundColor: colors.backgroundLight },
              ]}
            >
              <Ionicons name="search" size={20} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search..."
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={(text) => {
                  setSearch(text);
                  // Debounce could be added here
                }}
                onSubmitEditing={() => {
                  handleFetchItems(search);
                }}
              />
            </View>

            {_fetchError && !loading ? (
              <View
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={[
                  styles.errorBanner,
                  { backgroundColor: colors.errorLight },
                ]}
              >
                <Ionicons name="alert-circle" size={18} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {_fetchError}
                </Text>
              </View>
            ) : null}

            {loading ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={styles.loader}
              />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.list}
                {...getVirtualizedListProps()}
                renderItem={({ item }) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <Pressable
                      style={({ pressed }) => [
                        styles.itemRow,
                        { borderBottomColor: colors.border },
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => toggleSelection(item.id)}
                      accessible={true}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${item.name}`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      {item.images && item.images.length > 0 && (
                        <SafeImage
                          source={{ uri: item.images[0] }}
                          style={[
                            styles.itemImage,
                            { backgroundColor: colors.inputBg },
                          ]}
                          contentFit="cover"
                          transition={200}
                        />
                      )}
                      <View style={styles.itemInfo}>
                        <Text style={[styles.itemName, { color: colors.text }]}>
                          {item.name}
                        </Text>
                        {item.description ? (
                          <Text
                            style={[
                              styles.itemDesc,
                              { color: colors.textSecondary },
                            ]}
                            numberOfLines={2}
                          >
                            {stripHtmlTags(item.description)}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={24}
                          color={colors.primary}
                        />
                      )}
                    </Pressable>
                  );
                }}
              />
            )}
          </SafeAreaView>
        </AppKeyboardContainer>
      </SafeAreaProvider>
    </Modal>
  );
}
