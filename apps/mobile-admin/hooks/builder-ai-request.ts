export interface BuilderConfig {
  content: Array<{
    type: string;
    props: Record<string, unknown>;
  }>;
  root: {
    title?: string;
    [key: string]: unknown;
  };
  zones?: Record<string, unknown>;
  theme?: {
    colors?: {
      primary?: string;
      accent?: string;
      header?: Record<string, string>;
      footer?: Record<string, string>;
    };
    [key: string]: unknown;
  };
}

export interface BuilderApiResponse {
  config: BuilderConfig;
  seo?: Record<string, unknown>;
  storeSettings?: Record<string, unknown>;
  setupSettings?: Record<string, unknown>;
  publishedConfig?: BuilderConfig | null;
  isPublished?: boolean;
  isDefault?: boolean;
  lastUpdated?: string;
}

export interface LegacyBuilderAiResponse {
  config: BuilderConfig;
  error?: string;
}

export type GeminiResponse = LegacyBuilderAiResponse;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface BuilderMutationVariables {
  merchantId: string | null;
}

export interface MerchantBuilderDraft {
  merchantId: string;
  config: BuilderConfig;
}

export function isCurrentBuilderAiRequest(
  sequence: { current: number },
  requestSequence: number
) {
  return sequence.current === requestSequence;
}
