import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import type { EmailDomainColors } from './email-domain-settings.styles';
import { makeEmailDomainSettingsStyles } from './email-domain-settings.styles';

const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const registrationSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Enter a valid domain (e.g. mystore.com)')
    .max(100, 'Domain must be 100 characters or fewer')
    .regex(DOMAIN_PATTERN, 'Enter a valid domain (e.g. mystore.com)'),
});

type RegistrationValues = z.infer<typeof registrationSchema>;

interface TextInputChangeLike {
  currentTarget?: { value?: string };
  nativeEvent?: { text?: string };
  target?: { value?: string };
}

function getTextInputEventValue(event: TextInputChangeLike): string {
  return (
    event.nativeEvent?.text ??
    event.currentTarget?.value ??
    event.target?.value ??
    ''
  );
}

interface EmailDomainRegistrationFormProps {
  colors: EmailDomainColors;
  onSubmit: (domain: string) => void;
  pending: boolean;
  /** When set, renders a Cancel action (used when replacing an existing domain). */
  onCancel?: () => void;
}

export function EmailDomainRegistrationForm({
  colors,
  onSubmit,
  pending,
  onCancel,
}: EmailDomainRegistrationFormProps) {
  const styles = makeEmailDomainSettingsStyles(colors);
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { domain: '' },
  });

  const submit = form.handleSubmit((values) => onSubmit(values.domain));
  const domainError = form.formState.errors.domain?.message;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Your sending domain</Text>
      <Controller
        control={form.control}
        name="domain"
        render={({ field }) => (
          <TextInput
            style={[styles.input, domainError && styles.inputInvalid]}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(event) =>
              field.onChange(
                getTextInputEventValue(event as unknown as TextInputChangeLike)
              )
            }
            onChangeText={field.onChange}
            placeholder="yourstore.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Sending domain"
            aria-invalid={Boolean(domainError)}
          />
        )}
      />
      {domainError ? <Text style={styles.errorText}>{domainError}</Text> : null}
      <Pressable
        style={[styles.primaryButton, pending && styles.buttonDisabled]}
        disabled={pending}
        onPress={() => submit()}
        accessibilityRole="button"
        accessibilityLabel="Add domain"
        accessibilityState={{ busy: pending, disabled: pending }}
      >
        {pending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Add domain</Text>
        )}
      </Pressable>
      {onCancel ? (
        <Pressable
          style={styles.secondaryButton}
          disabled={pending}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
