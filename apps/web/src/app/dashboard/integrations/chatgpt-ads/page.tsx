'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useMerchant } from '@/hooks/use-merchant-client';
import { fetchWithCsrf } from '@/lib/api-client';
import { asRoute } from '@/lib/routes';
import {
  type ChatgptAdsConnection,
  chatgptAdsConnectionSchema,
} from '@/schemas/chatgpt-ads-settings';
import { ChatgptSetupGuide } from './setup-guide';

export default function ChatgptIntegrationPage() {
  const { merchant } = useMerchant();
  return merchant?.id ? (
    <ChatgptConnectionForm key={merchant.id} merchantId={merchant.id} />
  ) : (
    <p>Loading store…</p>
  );
}
function ChatgptConnectionForm({ merchantId }: { merchantId: string }) {
  const endpoint = `/api/integrations/chatgpt-ads?${new URLSearchParams({ merchantId })}`;
  const [connection, setConnection] = useState<ChatgptAdsConnection | null>(
    null
  );
  const [pixelId, setPixelId] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('load_failed');
        const data = chatgptAdsConnectionSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setConnection(data);
        setPixelId(data.pixelId ?? '');
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Could not load your connection. This setup is available to the store owner.'
          );
      });
    return () => controller.abort();
  }, [endpoint]);
  async function save(disconnect = false) {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetchWithCsrf(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          disconnect
            ? { pixelId: null, disconnect: true }
            : { pixelId: pixelId.trim(), capiKey: key.trim() }
        ),
      });
      if (!response.ok) throw new Error('save_failed');
      const data = chatgptAdsConnectionSchema.parse(await response.json());
      setConnection(data);
      setPixelId(data.pixelId ?? '');
      setKey('');
      setSaved(true);
    } catch {
      setError(
        'Could not save your connection. Check your owner access and Growth integrations plan, then retry.'
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={asRoute('/dashboard/integrations')}
            aria-label="Back to integrations"
          >
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">ChatGPT Ads</h1>
          <p className="text-muted-foreground">
            Connect website measurement and successful payment conversions.
          </p>
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!connection && !error ? <p>Loading connection…</p> : null}
      {connection ? (
        <Card>
          <CardHeader>
            <CardTitle>Pixel and Conversions API</CardTitle>
            <CardDescription>
              Use the Pixel ID and server key from your own Ads Manager account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="chatgpt-pixel-id">Pixel ID</label>
              <Input
                id="chatgpt-pixel-id"
                autoComplete="off"
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="chatgpt-capi-key">Conversions API key</label>
              <Input
                id="chatgpt-capi-key"
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  connection.capiConfigured
                    ? 'Leave blank to keep your saved key'
                    : 'Paste your server key'
                }
              />
              <p className="text-sm text-muted-foreground">
                Your saved key is never shown. Enter a new key only to replace
                it.
              </p>
            </div>
            <div className="text-sm">
              <p>
                {connection.pixelId
                  ? 'Pixel ID saved'
                  : 'Pixel ID not configured'}
              </p>
              <p>
                {connection.capiConfigured
                  ? 'Server key saved'
                  : 'Server key not configured'}
              </p>
              <p>
                Event delivery has not been verified on this screen. Check Event
                Stream in Ads Manager after setup.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              The Pixel measures consented browser activity. Successful payments
              are sent through Baci’s server event pipeline after full payment
              confirmation. Saving credentials does not activate ads or spend.
            </p>
            {saved ? <p role="status">Connection settings saved.</p> : null}
            <div className="flex gap-3">
              <Button
                onClick={() => void save()}
                disabled={saving || !pixelId.trim()}
              >
                {saving ? 'Saving…' : 'Save connection'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void save(true)}
                disabled={
                  saving || (!connection.pixelId && !connection.capiConfigured)
                }
              >
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ChatgptSetupGuide />
    </div>
  );
}
