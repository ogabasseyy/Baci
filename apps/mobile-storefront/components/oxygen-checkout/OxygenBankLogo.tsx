import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Colors from '@/constants/Colors';
import { oxygenBankLogo } from './oxygen-bank-logos';

export function OxygenBankLogo({ code }: { code: string }) {
  const source = oxygenBankLogo(code);
  const [failedSource, setFailedSource] = useState<typeof source>();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        {
          backgroundColor: Colors.light.background,
          borderColor: Colors.light.border,
        },
      ]}
    >
      {source && source !== failedSource ? (
        <Image
          source={source}
          resizeMode="contain"
          style={styles.logo}
          onError={() => setFailedSource(source)}
        />
      ) : (
        <Ionicons
          name="business-outline"
          size={18}
          color={Colors.light.textSecondary}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 9,
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 24, height: 24 },
});
