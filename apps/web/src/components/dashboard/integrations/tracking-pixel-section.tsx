'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface TrackingPixelSectionProps {
  platform: string;
  pixelId: string;
  tokenConfigured?: boolean;
  onDisconnect?: () => Promise<void>;
  pixelLabel: string;
  tokenLabel?: string;
  onSave: (pixelId: string, token: string) => Promise<void>;
  description?: string;
  children?: React.ReactNode;
}

export function TrackingPixelSection({
  platform,
  pixelId,
  tokenConfigured,
  onDisconnect,
  pixelLabel,
  tokenLabel,
  onSave,
  description,
  children,
}: TrackingPixelSectionProps) {
  const [localPixelId, setLocalPixelId] = useState(pixelId);
  const [localToken, setLocalToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    setIsSaving(true);
    onSave(localPixelId, localToken)
      .then(() => {
        setLocalToken('');
        toast({
          title: 'Settings Saved',
          description: `${platform} tracking settings have been updated.`,
        });
      })
      .catch(() => {
        toast({
          title: 'Error',
          description: 'Failed to save settings.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>{platform} Tracking</CardTitle>
        <CardDescription>
          {description ||
            'Configure Pixel and Conversion API for better ad tracking.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="pixel-id" className="text-sm font-medium">
            {pixelLabel}
          </label>
          <Input
            id="pixel-id"
            value={localPixelId}
            onChange={(e) => setLocalPixelId(e.target.value)}
            placeholder={`Enter your ${platform} Pixel ID`}
          />
        </div>
        {tokenLabel && (
          <div className="space-y-2">
            <label htmlFor="access-token" className="text-sm font-medium">
              {tokenLabel}
            </label>
            <Input
              id="access-token"
              value={localToken}
              onChange={(e) => setLocalToken(e.target.value)}
              type="password"
              placeholder={
                tokenConfigured
                  ? 'Saved securely; enter a replacement'
                  : 'Enter Access Token'
              }
            />
            <p className="text-xs text-muted-foreground">
              {tokenConfigured
                ? 'Credential saved. Leave blank to keep it.'
                : 'Required for server-side tracking.'}
            </p>
          </div>
        )}
        {tokenConfigured && onDisconnect && (
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => {
              setIsSaving(true);
              onDisconnect()
                .then(() => setLocalToken(''))
                .catch(() =>
                  toast({ title: 'Disconnect failed', variant: 'destructive' })
                )
                .finally(() => setIsSaving(false));
            }}
          >
            Disconnect server tracking
          </Button>
        )}
        {children}
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving…
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
