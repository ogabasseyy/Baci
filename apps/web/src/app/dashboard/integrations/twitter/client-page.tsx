'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMerchant } from '@/hooks/use-merchant-client';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type XAdsConnection,
  type XAdsCredentials,
  type XEventIds,
  xAdsConnectionSchema,
  xAdsSettingsSchema,
} from '@/schemas/x-ads-settings';

const eventLabels = {
  pageView: 'Page view',
  viewContent: 'Product view',
  addToCart: 'Add to cart',
  initiateCheckout: 'Begin checkout',
  purchase: 'Successful payment',
  search: 'Search',
  signUp: 'Registration',
  addToWishlist: 'Wishlist',
} satisfies Record<keyof XEventIds, string>;
const credentialLabels = {
  consumerKey: 'API key',
  consumerSecret: 'API key secret',
  accessToken: 'Access token',
  accessTokenSecret: 'Access token secret',
} satisfies Record<keyof XAdsCredentials, string>;
const emptyCredentials = {
  consumerKey: '',
  consumerSecret: '',
  accessToken: '',
  accessTokenSecret: '',
};
export default function XAdsIntegrationClient({
  initialMerchantId,
  initialConnection,
}: {
  initialMerchantId: string;
  initialConnection: XAdsConnection;
}) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id ?? initialMerchantId;
  const [snapshot, setSnapshot] = useState<{
    merchantId: string;
    connection: XAdsConnection;
  } | null>({ merchantId: initialMerchantId, connection: initialConnection });
  if (snapshot && snapshot.merchantId !== merchantId) setSnapshot(null);
  return (
    <ConnectionForm
      key={merchantId}
      merchantId={merchantId}
      initialConnection={
        snapshot?.merchantId === merchantId ? snapshot.connection : undefined
      }
    />
  );
}
function ConnectionForm({
  merchantId,
  initialConnection,
}: {
  merchantId: string;
  initialConnection?: XAdsConnection;
}) {
  const endpoint = `/api/integrations/x-ads?${new URLSearchParams({ merchantId })}`;
  const [connection, setConnection] = useState(initialConnection ?? null);
  const [pixelId, setPixelId] = useState(initialConnection?.pixelId ?? '');
  const [eventIds, setEventIds] = useState<XEventIds>(
    initialConnection?.eventIds ?? {}
  );
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [pixelToken, setPixelToken] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (initialConnection) return;
    const controller = new AbortController();
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = xAdsConnectionSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setConnection(data);
          setPixelId(data.pixelId ?? '');
          setEventIds(data.eventIds);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load this store’s X connection.');
      });
    return () => controller.abort();
  }, [endpoint, initialConnection]);
  async function save(disconnect = false) {
    setSaved(false);
    setError('');
    const parsed = xAdsSettingsSchema.safeParse({
      pixelId: disconnect ? null : pixelId || null,
      eventIds: disconnect
        ? {}
        : Object.fromEntries(
            Object.entries(eventIds).filter(([, value]) => value.trim())
          ),
      ...(!disconnect &&
      (pixelToken || Object.values(credentials).some(Boolean))
        ? {
            credentials: {
              ...(pixelToken ? { pixelToken } : {}),
              ...(Object.values(credentials).some(Boolean) ? credentials : {}),
            },
          }
        : {}),
      disconnect,
    });
    if (!parsed.success) {
      setError(
        'Enter a Pixel ID, matching event codes, and a Conversion API access token or all four OAuth credentials. Use one method at a time.'
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetchWithCsrf(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error();
      const data = xAdsConnectionSchema.parse(await response.json());
      setConnection(data);
      setPixelId(data.pixelId ?? '');
      setEventIds(data.eventIds);
      setCredentials(emptyCredentials);
      setPixelToken('');
      setSaved(true);
    } catch {
      setError('Could not save this store’s X connection.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">X Ads conversion tracking</h1>
      <p>
        Use the existing Pixel and event codes from X Ads → Events Manager. Each
        event code belongs to that Pixel. Successful-payment events are sent
        only after Baci confirms the full payment.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block" htmlFor="x-pixel-id">
          Pixel ID
          <Input
            id="x-pixel-id"
            value={pixelId}
            onChange={(event) => setPixelId(event.target.value)}
            autoComplete="off"
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Event codes</legend>
          {Object.entries(eventLabels).map(([key, label]) => (
            <label key={key} className="block" htmlFor={`x-${key}`}>
              {label}
              <Input
                id={`x-${key}`}
                value={eventIds[key as keyof XEventIds] ?? ''}
                onChange={(event) =>
                  setEventIds({ ...eventIds, [key]: event.target.value })
                }
                placeholder={`tw-${pixelId || 'pixel'}-event`}
                autoComplete="off"
              />
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Conversions API credentials</legend>
          <label htmlFor="x-pixel-token" className="block">
            Conversions API access token
            <Input
              id="x-pixel-token"
              type="password"
              value={pixelToken}
              onChange={(event) => setPixelToken(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <p>
            Copy the access token from X Events Manager → Install Pixel → Manual
            → Conversion API. Leave blank to keep saved access. Use either this
            token or the four OAuth fields below.
          </p>
          <p>
            {connection?.capiConfigured
              ? 'Server credentials saved. Leave these fields blank to keep them.'
              : 'Server access is optional for browser tracking. The OAuth alternative below requires an Ads API-approved X application and a user with account access.'}
          </p>
          {Object.entries(credentialLabels).map(([key, label]) => (
            <label key={key} className="block" htmlFor={`x-${key}`}>
              {label}
              <Input
                id={`x-${key}`}
                type="password"
                value={credentials[key as keyof XAdsCredentials]}
                onChange={(event) =>
                  setCredentials({ ...credentials, [key]: event.target.value })
                }
                autoComplete="new-password"
              />
            </label>
          ))}
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
        {saved ? <p role="status">X connection saved for this store.</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving || !connection}>
            Save connection
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving || !connection}
            onClick={() => void save(true)}
          >
            Disconnect
          </Button>
        </div>
      </form>
      <p>
        Test browser events in X Events Manager, then verify server receipts
        after a controlled paid order. Saved credentials alone do not confirm
        delivery. Do not include credentials in screenshots.
      </p>
    </main>
  );
}
