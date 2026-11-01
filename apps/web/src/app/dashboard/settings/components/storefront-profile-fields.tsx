import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SettingsFormValues, settingsSchema } from './settings-utils';

type SettingsFormInput = z.input<typeof settingsSchema>;

interface StorefrontProfileFieldsProps {
  form: UseFormReturn<SettingsFormInput, unknown, SettingsFormValues>;
}

export function StorefrontProfileFields({
  form,
}: StorefrontProfileFieldsProps) {
  const { errors } = form.formState;

  return (
    <Card
      id="storefront-profile"
      data-testid="storefront-profile"
      className="glass"
    >
      <CardHeader>
        <CardTitle>Storefront profile</CardTitle>
        <CardDescription>
          Help customers and search engines understand your store and contact
          you.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-2" htmlFor="site_description">
          <span className="font-medium text-sm">Store description</span>
          <Textarea
            id="site_description"
            maxLength={320}
            aria-invalid={Boolean(errors.site_description)}
            aria-describedby={
              errors.site_description ? 'site_description-error' : undefined
            }
            {...form.register('site_description')}
          />
          {errors.site_description && (
            <span
              id="site_description-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {errors.site_description.message}
            </span>
          )}
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2" htmlFor="support_email">
            <span className="font-medium text-sm">Public support email</span>
            <Input
              id="support_email"
              type="email"
              aria-invalid={Boolean(errors.support_email)}
              aria-describedby={
                errors.support_email ? 'support_email-error' : undefined
              }
              {...form.register('support_email')}
            />
            {errors.support_email && (
              <span
                id="support_email-error"
                role="alert"
                className="text-destructive text-sm"
              >
                {errors.support_email.message}
              </span>
            )}
          </label>
          <label className="grid gap-2" htmlFor="support_phone">
            <span className="font-medium text-sm">Public support phone</span>
            <Input
              id="support_phone"
              type="tel"
              aria-invalid={Boolean(errors.support_phone)}
              aria-describedby={
                errors.support_phone ? 'support_phone-error' : undefined
              }
              {...form.register('support_phone')}
            />
            {errors.support_phone && (
              <span
                id="support_phone-error"
                role="alert"
                className="text-destructive text-sm"
              >
                {errors.support_phone.message}
              </span>
            )}
          </label>
        </div>
        <div className="grid gap-2">
          <label className="font-medium text-sm" htmlFor="phone">
            Business phone (used for courier pickups)
          </label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={
              errors.phone ? 'phone-hint phone-error' : 'phone-hint'
            }
            {...form.register('phone')}
          />
          <span id="phone-hint" className="text-muted-foreground text-sm">
            Couriers call this number to collect your orders. Enter the full
            number with its country code, for example +234 801 234 5678.
          </span>
          {errors.phone && (
            <span
              id="phone-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {errors.phone.message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
