import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ThemeColors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import type { BuilderConfig } from '@/hooks/useBuilderConfig';
import { useMerchant } from '@/hooks/useMerchant';
import { BASE_URL } from '@/lib/api-base-url';
import { useAuthStore } from '@/stores/auth-store';
import { BufferedNativeCustomizePreviewPane } from './BufferedNativeCustomizePreviewPane';
import { buildPreviewUrl } from './build-preview-url';
import { CustomizePreviewPane } from './CustomizePreviewPane';
import { buildNativePreviewUrl } from './native-preview-script';

interface Props {
  colors: ThemeColors;
  config: BuilderConfig | null;
  previewKey: number;
}

export function CustomizePreviewSwitch({ colors, config, previewKey }: Props) {
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const { user, session } = useAuth();
  const { merchant, resolvedForUserId, storeUrl } = useMerchant();
  const previewUrl = buildPreviewUrl(storeUrl, previewKey);
  const queryClient = useQueryClient();
  const nativeUrl = buildNativePreviewUrl(BASE_URL);
  const userId = user?.id;
  const merchantId = merchant?.id;
  const slug = merchant?.slug;
  const currentFallbackKey = `${userId}:${merchantId}:${previewKey}`;
  if (
    fallbackKey === currentFallbackKey ||
    !config ||
    !nativeUrl ||
    !userId ||
    session?.user.id !== userId ||
    !merchantId ||
    !slug ||
    resolvedForUserId !== userId
  ) {
    return (
      <CustomizePreviewPane
        colors={colors}
        previewKey={previewKey}
        previewUrl={previewUrl}
      />
    );
  }
  const identityKey = `${userId}:${merchantId}`;
  const isIdentityCurrent = () => {
    const current = queryClient.getQueryData<{
      resolvedForUserId: string;
      merchant: { id: string } | null;
    }>(['merchant', userId]);
    const auth = useAuthStore.getState();
    return (
      auth.user?.id === userId &&
      auth.session?.user.id === userId &&
      current?.resolvedForUserId === userId &&
      current.merchant?.id === merchantId
    );
  };
  return (
    <BufferedNativeCustomizePreviewPane
      key={`${identityKey}:${nativeUrl}`}
      colors={colors}
      config={config}
      draftRevision={previewKey}
      identityKey={identityKey}
      isIdentityCurrent={isIdentityCurrent}
      onFallback={() => setFallbackKey(currentFallbackKey)}
      merchant={{ id: merchantId, slug }}
      previewUrl={nativeUrl}
    />
  );
}
