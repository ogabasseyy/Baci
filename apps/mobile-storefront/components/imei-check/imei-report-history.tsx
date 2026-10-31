import {
  fetchImeiReports,
  IMEI_SERVICE_TIERS,
  type ImeiReport,
} from '@baci/shared/imei';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ImeiCheckerColors } from './imei-check.types';
export function ImeiReportHistory({
  accessToken,
  apiBaseUrl,
  scope,
  colors,
  onOpen,
  disabled = false,
}: {
  accessToken?: string;
  apiBaseUrl: string;
  scope: string;
  colors: ImeiCheckerColors;
  onOpen: (report: ImeiReport) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const requestScope = `${scope}:${page}:${attempt}`;
  const [state, setState] = useState<{
    scope: string;
    loading: boolean;
    reports: ImeiReport[];
    hasMore: boolean;
    error: string | null;
  }>({
    scope: requestScope,
    loading: false,
    reports: [],
    hasMore: false,
    error: null,
  });
  useEffect(() => {
    if (!expanded || !accessToken) return;
    const controller = new AbortController();
    setState({
      scope: requestScope,
      loading: true,
      reports: [],
      hasMore: false,
      error: null,
    });
    void fetchImeiReports({
      apiBaseUrl,
      accessToken,
      page,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({
            scope: requestScope,
            loading: false,
            ...data,
            error: null,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            scope: requestScope,
            loading: false,
            reports: [],
            hasMore: false,
            error: 'Unable to load reports. Please try again.',
          });
      });
    return () => controller.abort();
  }, [expanded, apiBaseUrl, accessToken, page, requestScope]);
  const visible = state.scope === requestScope;
  return (
    <View style={{ padding: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          setPage(0);
          setExpanded(!expanded);
        }}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          My completed reports
        </Text>
      </Pressable>
      {expanded ? (
        <View
          style={{
            backgroundColor: colors.card,
            padding: 12,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: colors.text }}>
            Reopen a saved report for free. New checks are charged separately.
          </Text>
          {!accessToken ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/auth/login?returnTo=/imei-check')}
            >
              <Text style={{ color: colors.text }}>
                Sign in to view reports
              </Text>
            </Pressable>
          ) : null}
          {accessToken && (!visible || state.loading) ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.text }}
            >
              Loading reports…
            </Text>
          ) : null}
          {accessToken && visible && state.error ? (
            <>
              <Text accessibilityRole="alert" style={{ color: colors.text }}>
                {state.error}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAttempt(attempt + 1)}
              >
                <Text style={{ color: colors.text }}>Retry reports</Text>
              </Pressable>
            </>
          ) : null}
          {accessToken && visible && !state.loading && !state.error ? (
            <>
              <ScrollView style={{ maxHeight: 240 }}>
                {state.reports.length === 0 ? (
                  <Text style={{ color: colors.text }}>
                    No completed reports on this page.
                  </Text>
                ) : (
                  state.reports.map((report) => (
                    <Pressable
                      key={report.lookupId}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${IMEI_SERVICE_TIERS[report.tier].name} report for ${report.result.device}`}
                      style={{ paddingVertical: 12, minHeight: 44 }}
                      onPress={() => {
                        onOpen(report);
                        setExpanded(false);
                      }}
                    >
                      <Text style={{ color: colors.text }}>
                        Open {IMEI_SERVICE_TIERS[report.tier].name} report for{' '}
                        {report.result.device}
                      </Text>
                      <Text style={{ color: colors.textSecondary }}>
                        Ending {report.result.imei.slice(-4)} ·{' '}
                        {new Date(report.createdAt).toLocaleDateString()}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              {page > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage(page - 1)}
                >
                  <Text style={{ color: colors.text }}>Newer reports</Text>
                </Pressable>
              ) : null}
              {state.hasMore ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage(page + 1)}
                >
                  <Text style={{ color: colors.text }}>Older reports</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
