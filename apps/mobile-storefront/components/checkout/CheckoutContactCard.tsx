import Ionicons from '@react-native-vector-icons/ionicons';
import type { Control, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { Text, View } from 'react-native';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { BRAND } from '@/constants/Colors';
import type { ShippingAddressInput } from '@/lib/validation';
import { checkoutContactCardStyles as styles } from './CheckoutContactCard.styles';
import { CheckoutFormField } from './CheckoutFormField';
import { CheckoutGuestSaveDetails } from './CheckoutGuestSaveDetails';
import { CollapsibleCheckoutCard } from './selection/CollapsibleCheckoutCard';

// Email addresses can't contain whitespace; strip it as the user types so a
// stray space (common on mobile keyboards after autocomplete) can't produce a
// validation error they have to hunt for.
function stripEmailWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

type CheckoutContactCardColors = {
  background: string;
  border: string;
  card: string;
  error: string;
  muted: string;
  placeholder: string;
  text: string;
  textSecondary: string;
};

type CheckoutContactCardProps = {
  accountPassword: string;
  colors: CheckoutContactCardColors;
  contactSummary: string;
  control: Control<ShippingAddressInput>;
  email?: string;
  errors: FieldErrors<ShippingAddressInput>;
  hasContactIdentity: boolean;
  isAuthenticated: boolean;
  isCollapsed: boolean;
  isDark: boolean;
  onChangeAccountPassword: (value: string) => void;
  onContactEmailSettled?: () => void;
  onToggleCollapsed: () => void;
  onToggleSaveDetails: () => void;
  phone?: string;
  saveDetails: boolean;
};

const CONTACT_NAME_FIELDS = [
  { label: 'First Name', name: 'firstName', placeholder: 'E.g. John' },
  { label: 'Last Name', name: 'lastName', placeholder: 'E.g. Doe' },
] as const;

export function CheckoutContactCard({
  accountPassword,
  colors,
  contactSummary,
  control,
  email,
  errors,
  hasContactIdentity,
  isAuthenticated,
  isCollapsed,
  isDark,
  onChangeAccountPassword,
  onContactEmailSettled,
  onToggleCollapsed,
  onToggleSaveDetails,
  phone,
  saveDetails,
}: CheckoutContactCardProps) {
  const showCollapseAction = hasContactIdentity;

  return (
    <CollapsibleCheckoutCard
      icon="person-outline"
      title="Contact"
      colors={colors}
      isDark={isDark}
      collapsed={showCollapseAction && isCollapsed}
      canCollapse={showCollapseAction}
      onToggle={onToggleCollapsed}
      overflowVisible
      zIndex={20}
      summary={
        <ContactSummary
          colors={colors}
          contactSummary={contactSummary}
          email={email}
          isAuthenticated={isAuthenticated}
          phone={phone}
        />
      }
    >
      <View style={[styles.cardBody, styles.contactCardBody]}>
        <View style={styles.row}>
          {CONTACT_NAME_FIELDS.map((field) => (
            <View key={field.name} style={styles.halfInput}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {field.label}
              </Text>
              <CheckoutFormField
                autoCapitalize="words"
                colors={colors}
                control={control}
                errors={errors}
                isDark={isDark}
                label=""
                name={field.name}
                onBlur={onContactEmailSettled}
                placeholder={field.placeholder}
              />
            </View>
          ))}
        </View>

        <Text
          style={[
            styles.label,
            { color: colors.textSecondary, marginBottom: 8 },
          ]}
        >
          Phone Number
        </Text>
        <Controller
          control={control}
          name="phone"
          render={({ field: { onBlur, onChange, value } }) => (
            <PhoneInput
              containerStyle={styles.compactInputGroup}
              error={errors.phone?.message}
              onBlur={() => {
                onBlur();
                onContactEmailSettled?.();
              }}
              onChangeText={onChange}
              value={value}
            />
          )}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Email Address
        </Text>
        <CheckoutFormField
          autoCapitalize="none"
          colors={colors}
          containerStyle={styles.compactInputGroup}
          control={control}
          errors={errors}
          isDark={isDark}
          keyboardType="email-address"
          label=""
          name="email"
          placeholder="john@example.com"
          onBlur={onContactEmailSettled}
          onSubmitEditing={onContactEmailSettled}
          returnKeyType="done"
          transformText={stripEmailWhitespace}
        />

        {!isAuthenticated ? (
          <CheckoutGuestSaveDetails
            accountPassword={accountPassword}
            colors={colors}
            onChangeAccountPassword={onChangeAccountPassword}
            onToggleSaveDetails={onToggleSaveDetails}
            saveDetails={saveDetails}
          />
        ) : null}
      </View>
    </CollapsibleCheckoutCard>
  );
}

function ContactSummary({
  colors,
  contactSummary,
  email,
  isAuthenticated,
  phone,
}: Pick<
  CheckoutContactCardProps,
  'colors' | 'contactSummary' | 'email' | 'isAuthenticated' | 'phone'
>) {
  return (
    <View
      style={[
        styles.summaryPanel,
        {
          // Recessed dark fill — the same "premium dark" as the delivery-method
          // rows — so a completed section reads as settled, not washed grey.
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryChip,
            { backgroundColor: `${colors.textSecondary}10` },
          ]}
        >
          <Ionicons
            name="person-circle-outline"
            size={22}
            color={BRAND.primary}
          />
        </View>
        <View style={styles.summaryBody}>
          <Text
            style={[styles.summaryMetaLabel, { color: colors.textSecondary }]}
          >
            {isAuthenticated ? 'Signed in' : 'Contact details'}
          </Text>
          <Text style={[styles.summaryTitle, { color: colors.text }]}>
            {contactSummary || 'Contact details'}
          </Text>
          {email ? (
            <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
              {email}
            </Text>
          ) : null}
          {phone ? (
            <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
              {phone}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
