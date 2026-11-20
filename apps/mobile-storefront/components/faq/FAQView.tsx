import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import { styles } from './faq.styles';

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

export interface SupportOption {
  id: string;
  title: string;
  subtitle: string;
  icon: IoniconsIconName;
  iconBackgroundColor: string;
  iconColor: string;
  action: () => void;
}

export interface StoreInfo {
  address: string;
  hours: string[];
}

interface FAQViewProps {
  colors: typeof Colors.light;
  expandedId: string | null;
  faqItems: FAQItem[];
  onToggleExpand: (id: string) => void;
  storeInfo: StoreInfo;
  supportOptions: SupportOption[];
}

export function FAQView({
  colors,
  expandedId,
  faqItems,
  onToggleExpand,
  storeInfo,
  supportOptions,
}: FAQViewProps) {
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom', 'left', 'right']}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Contact Us
          </Text>
          <View style={styles.supportGrid}>
            {supportOptions.map((option) => (
              <Pressable
                accessibilityLabel={`Contact support using ${option.title}`}
                accessibilityRole="button"
                key={option.id}
                style={[styles.supportCard, { backgroundColor: colors.card }]}
                onPress={option.action}
              >
                <View
                  style={[
                    styles.supportIconContainer,
                    { backgroundColor: option.iconBackgroundColor },
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={option.iconColor}
                  />
                </View>
                <Text style={[styles.supportTitle, { color: colors.text }]}>
                  {option.title}
                </Text>
                <Text
                  style={[
                    styles.supportSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {option.subtitle}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Frequently Asked Questions
          </Text>
          <View style={styles.faqList}>
            {faqItems.map((item) => {
              const isExpanded = expandedId === item.id;

              return (
                <Pressable
                  accessibilityLabel={item.question}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  key={item.id}
                  onPress={() => onToggleExpand(item.id)}
                  style={[
                    styles.faqItem,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.faqHeader}>
                    <Text
                      numberOfLines={isExpanded ? undefined : 2}
                      style={[styles.faqQuestion, { color: colors.text }]}
                    >
                      {item.question}
                    </Text>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </View>
                  {isExpanded && (
                    <Text
                      style={[
                        styles.faqAnswer,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.answer}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.storeInfo, { backgroundColor: colors.card }]}>
          <Text style={[styles.storeInfoTitle, { color: colors.text }]}>
            Store Hours
          </Text>
          {storeInfo.hours.map((hours) => (
            <Text
              key={hours}
              style={[styles.storeInfoText, { color: colors.textSecondary }]}
            >
              {hours}
            </Text>
          ))}
          <View style={styles.storeAddressContainer}>
            <Ionicons
              name="location-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.storeInfoText, { color: colors.textSecondary }]}
            >
              {storeInfo.address}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
