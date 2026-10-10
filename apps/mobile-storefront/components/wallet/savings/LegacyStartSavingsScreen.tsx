import { useEffect, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { StartSavingsForm } from './StartSavingsForm';
import { StartSavingsModals } from './StartSavingsModals';
import { startSavingsStyles as styles } from './start-savings.styles';
import { useStartSavingsController } from './use-start-savings-controller';

export function LegacyStartSavingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const controller = useStartSavingsController();
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectingProduct, setSelectingProduct] = useState(false);
  const mounted = useRef(true);
  const selectionPending = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
    };
  }, []);
  const selectProduct: typeof controller.selectProduct = async (...args) => {
    if (selectionPending.current) return;
    selectionPending.current = true;
    setSelectingProduct(true);
    controller.selectProduct(...args);
    if (KeyboardController.isVisible()) await KeyboardController.dismiss();
    if (!mounted.current) return;
    setSearchFocused(false);
    scrollFrame.current = requestAnimationFrame(() => {
      selectionPending.current = false;
      setSelectingProduct(false);
      scrollFrame.current = null;
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppKeyboardAwareScrollView
        enabled={!selectingProduct}
        bottomOffset={searchFocused ? 200 : 24}
        disableScrollOnKeyboardHide
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={controller.isRefetching}
            onRefresh={controller.refetch}
            tintColor={BRAND.primary}
          />
        }
      >
        <StartSavingsForm
          onSearchFocusChange={setSearchFocused}
          colors={colors}
          controller={{ ...controller, selectProduct }}
        />
      </AppKeyboardAwareScrollView>

      <StartSavingsModals colors={colors} controller={controller} />
    </View>
  );
}
