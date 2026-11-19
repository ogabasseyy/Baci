import { getAppUrl } from '@/env';
import { getConfiguredAgenticMerchantSlug } from '@/lib/agentic/agentic-merchant-slug';
import { logger } from '@/lib/logger';

// Keep the probe longer than the buffered chat completion budget so it can
// classify a slow/static response instead of aborting during valid inference.
const SUPPORT_CHAT_FETCH_TIMEOUT_MS = 75_000;
// The customer chat route buffers a bounded AI completion. Treat responses over
// 30s as attention-worthy, while avoiding false alarms for healthy 10-20s VPS
// generations observed under the 60s route budget.
const SUPPORT_CHAT_SLOW_RESPONSE_MS = 30_000;
const SUPPORT_CHAT_SMOKE_PROMPT = 'Best gaming phones';
const SUPPORT_CHAT_CONVERSATION_PROMPT = 'Can you help me today?';

type AgentCommerceSupportChatHealthStatus = 'attention' | 'ok';

export interface AgentCommerceSupportChatHealthIssue {
  code:
    | 'support_chat_slow'
    | 'support_chat_static_fallback'
    | 'support_chat_unavailable';
  message: string;
}

export interface AgentCommerceSupportChatHealthResult {
  issue_count: number;
  issues: AgentCommerceSupportChatHealthIssue[];
  response_time_ms: number;
  status: AgentCommerceSupportChatHealthStatus;
  url: string;
}

function createSupportChatIssueResult({
  issue,
  responseTimeMs,
  url,
}: {
  issue: AgentCommerceSupportChatHealthIssue;
  responseTimeMs: number;
  url: string;
}): AgentCommerceSupportChatHealthResult {
  return {
    issue_count: 1,
    issues: [issue],
    response_time_ms: responseTimeMs,
    status: 'attention',
    url,
  };
}

export async function checkAgentCommerceSupportChatHealth(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<AgentCommerceSupportChatHealthResult> {
  const url = new URL('/api/chat', getAppUrl()).toString();
  const startedAt = now();

  try {
    // Exercise both the catalog fast path and the provider-backed conversation
    // path. Run concurrently so monitoring reflects customer-visible latency.
    const responses = await Promise.all(
      [SUPPORT_CHAT_SMOKE_PROMPT, SUPPORT_CHAT_CONVERSATION_PROMPT].map(
        async (prompt) => {
          const response = await fetcher(url, {
            body: JSON.stringify({
              messages: [{ content: prompt, role: 'user' }],
            }),
            cache: 'no-store',
            headers: {
              accept: 'text/plain',
              'content-type': 'application/json',
            },
            method: 'POST',
            signal: AbortSignal.timeout(SUPPORT_CHAT_FETCH_TIMEOUT_MS),
          });
          await response.body?.cancel();
          return response;
        }
      )
    );
    const responseTimeMs = Math.max(0, now() - startedAt);

    const failed = responses.find((response) => !response.ok);
    if (failed) {
      return createSupportChatIssueResult({
        issue: {
          code: 'support_chat_unavailable',
          message: `Support chat returned HTTP ${failed.status}.`,
        },
        responseTimeMs,
        url,
      });
    }

    if (
      responses.some(
        (response) =>
          response.headers.get('x-baci-chat-fallback') === 'catalog_unavailable'
      )
    ) {
      return createSupportChatIssueResult({
        issue: {
          code: 'support_chat_unavailable',
          message: 'Support chat could not check the catalog.',
        },
        responseTimeMs,
        url,
      });
    }

    if (
      responses.some(
        (response) => response.headers.get('x-baci-chat-fallback') === 'static'
      )
    ) {
      return createSupportChatIssueResult({
        issue: {
          code: 'support_chat_static_fallback',
          message:
            'Support chat returned its static provider-failure fallback.',
        },
        responseTimeMs,
        url,
      });
    }

    if (
      getConfiguredAgenticMerchantSlug() === 'ogabassey' &&
      (responses[0].headers.get('x-baci-chat-catalog') !== 'checked' ||
        responses.some(
          (response) =>
            response.headers.get('x-baci-santa-merchant-slug') !== 'ogabassey'
        ))
    ) {
      return createSupportChatIssueResult({
        issue: {
          code: 'support_chat_unavailable',
          message:
            'Support chat could not verify the configured catalog and tenant.',
        },
        responseTimeMs,
        url,
      });
    }

    if (responseTimeMs > SUPPORT_CHAT_SLOW_RESPONSE_MS) {
      return createSupportChatIssueResult({
        issue: {
          code: 'support_chat_slow',
          message: `Support chat response time exceeded ${SUPPORT_CHAT_SLOW_RESPONSE_MS} ms.`,
        },
        responseTimeMs,
        url,
      });
    }

    return {
      issue_count: 0,
      issues: [],
      response_time_ms: responseTimeMs,
      status: 'ok',
      url,
    };
  } catch (error) {
    logger.error({
      error,
      message: 'Support chat health request failed',
      url,
    });
    return createSupportChatIssueResult({
      issue: {
        code: 'support_chat_unavailable',
        message: 'Support chat could not be fetched.',
      },
      responseTimeMs: Math.max(0, now() - startedAt),
      url,
    });
  }
}
