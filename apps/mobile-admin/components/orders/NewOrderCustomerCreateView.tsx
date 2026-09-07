import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { type RefObject, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SheetTextInput,
  type SheetTextInputRef,
} from '@/components/ui/SheetTextInput';
import type { NewOrderController } from '@/hooks/useNewOrderController';
import { DuplicateCustomerBanner } from './DuplicateCustomerBanner';
import { NewCustomerAddressInput } from './NewCustomerAddressInput';
import { NewCustomerTypeToggle } from './NewCustomerTypeToggle';
import { NewOrderCustomerContactSection } from './NewOrderCustomerContactSection';
import { customerCreateStyles as customerStyles } from './NewOrderCustomerCreateView.styles';
import { styles } from './new-order.styles';

interface NewOrderCustomerCreateViewProps {
  controller: NewOrderController;
}

interface CustomerInfoFieldProps {
  colors: NewOrderController['colors'];
  icon: IoniconsIconName;
  inputRef?: RefObject<SheetTextInputRef | null>;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  placeholder: string;
  value: string;
}

function CustomerInfoField({
  colors,
  icon,
  inputRef,
  onChangeText,
  onSubmitEditing,
  placeholder,
  value,
}: CustomerInfoFieldProps) {
  return (
    <View
      style={[
        customerStyles.field,
        { backgroundColor: colors.inputBg, borderColor: colors.border },
      ]}
    >
      <Ionicons color={colors.textMuted} name={icon} size={17} />
      <SheetTextInput
        accessibilityLabel={placeholder}
        ref={inputRef}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="next"
        submitBehavior="submit"
        style={[customerStyles.fieldInput, { color: colors.text }]}
        value={value}
      />
    </View>
  );
}

export function NewOrderCustomerCreateView({
  controller,
}: NewOrderCustomerCreateViewProps) {
  const {
    colors,
    createCustomerMutation,
    duplicateCustomer,
    handleCreateCustomer,
    handleSelectCustomer,
    newCustomer,
    resetNewCustomerForm,
    selectedCountryCode,
    setDuplicateCustomer,
    setIsCreatingCustomer,
    setNewCustomer,
    setSelectedCountryCode,
  } = controller;

  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const lastNameInputRef = useRef<SheetTextInputRef>(null);
  const phoneInputRef = useRef<SheetTextInputRef>(null);
  const emailInputRef = useRef<SheetTextInputRef>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { height: windowHeight } = useWindowDimensions();
  // Reserve room below the last field so the focused address input can scroll
  // up and its (position:absolute) predictions dropdown clears the keyboard.
  const addressDropdownReserve = Math.max(220, Math.round(windowHeight * 0.35));
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [isAddressDetailsPending, setIsAddressDetailsPending] = useState(false);
  const isCompany = newCustomer.customerType === 'company';
  const isSaveDisabled =
    createCustomerMutation.isPending || isAddressDetailsPending;

  return (
    <BottomSheetScrollView
      ref={scrollRef}
      contentContainerStyle={customerStyles.content}
      keyboardShouldPersistTaps="handled"
    >
      {duplicateCustomer ? (
        <DuplicateCustomerBanner
          colors={colors}
          duplicateCustomer={duplicateCustomer}
          handleSelectCustomer={handleSelectCustomer}
          resetNewCustomerForm={resetNewCustomerForm}
          setDuplicateCustomer={setDuplicateCustomer}
          setIsCreatingCustomer={setIsCreatingCustomer}
        />
      ) : null}

      <View style={customerStyles.section}>
        <View style={customerStyles.sectionHeader}>
          <View
            style={[
              customerStyles.sectionIcon,
              { backgroundColor: colors.primaryLight },
            ]}
          >
            <Ionicons
              color={colors.primary}
              name={isCompany ? 'business-outline' : 'person-outline'}
              size={17}
            />
          </View>
          <Text style={[customerStyles.sectionTitle, { color: colors.text }]}>
            {isCompany ? 'Company Info' : 'Personal Info'}
          </Text>
        </View>

        <NewCustomerTypeToggle
          colors={colors}
          onChange={(customerType) => {
            setNewCustomer((previous) => ({
              ...previous,
              customerType,
              ...(customerType === 'company'
                ? { firstName: '', lastName: '' }
                : { companyName: '' }),
            }));
          }}
          value={newCustomer.customerType}
        />

        {isCompany ? (
          <CustomerInfoField
            colors={colors}
            icon="business"
            onChangeText={(text) =>
              setNewCustomer((previous) => ({
                ...previous,
                companyName: text,
              }))
            }
            onSubmitEditing={() => phoneInputRef.current?.focus()}
            placeholder="Company Name"
            value={newCustomer.companyName}
          />
        ) : (
          <View style={customerStyles.nameRow}>
            <CustomerInfoField
              colors={colors}
              icon="person"
              onChangeText={(text) =>
                setNewCustomer((previous) => ({
                  ...previous,
                  firstName: text,
                }))
              }
              onSubmitEditing={() => lastNameInputRef.current?.focus()}
              placeholder="First Name"
              value={newCustomer.firstName}
            />
            <CustomerInfoField
              colors={colors}
              icon="person"
              inputRef={lastNameInputRef}
              onChangeText={(text) =>
                setNewCustomer((previous) => ({
                  ...previous,
                  lastName: text,
                }))
              }
              onSubmitEditing={() => phoneInputRef.current?.focus()}
              placeholder="Last Name"
              value={newCustomer.lastName}
            />
          </View>
        )}
      </View>

      <NewOrderCustomerContactSection
        colors={colors}
        emailInputRef={emailInputRef}
        newCustomer={newCustomer}
        phoneInputRef={phoneInputRef}
        selectedCountryCode={selectedCountryCode}
        setNewCustomer={setNewCustomer}
        setSelectedCountryCode={setSelectedCountryCode}
      />

      <NewCustomerAddressInput
        address={newCustomer.address}
        city={newCustomer.city}
        colors={colors}
        googleMapsApiKey={googleMapsApiKey}
        onAddressBlur={() => setIsAddressFocused(false)}
        onAddressDetailsPendingChange={setIsAddressDetailsPending}
        onAddressFocus={() => {
          setIsAddressFocused(true);
          // Wait for the keyboard to settle, then bring the field + reserved
          // space into view above it.
          setTimeout(() => {
            scrollRef.current?.scrollToEnd({ animated: true });
          }, 150);
        }}
        selectedCountryCode={selectedCountryCode}
        setNewCustomer={setNewCustomer}
        state={newCustomer.state}
      />

      <Pressable
        accessibilityLabel="Save customer"
        accessibilityRole="button"
        accessibilityState={{
          disabled: isSaveDisabled,
          busy: isSaveDisabled,
        }}
        disabled={isSaveDisabled}
        onPress={handleCreateCustomer}
        style={[
          styles.payBtn,
          {
            backgroundColor: colors.primary,
            justifyContent: 'center',
            marginTop: 16,
          },
        ]}
      >
        {isSaveDisabled ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={[styles.payBtnText, { color: colors.textOnPrimary }]}>
            Save Customer
          </Text>
        )}
      </Pressable>

      {isAddressFocused ? (
        <View style={{ height: addressDropdownReserve }} />
      ) : null}
    </BottomSheetScrollView>
  );
}
