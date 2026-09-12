import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import {
  NegotiationCard,
  type NegotiationCardRequest,
} from '@/components/negotiations/NegotiationCard';
import {
  openNegotiationEvidence,
  openNegotiationExternalUrl,
} from '@/components/negotiations/negotiation-evidence-actions';
import { negotiationScreenStyles as styles } from '@/components/negotiations/negotiations-screen.styles';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

type NegotiationRequest = NegotiationCardRequest;

type ResolveNegotiationResponse = {
  channel?: 'email';
  manualContactAvailable?: boolean;
  notified: boolean;
  reason?: 'no_customer_email' | 'no_delivery_channel';
  status: 'accepted' | 'rejected';
};

// Module-scope helpers keep try/throw out of the component body so React
// Compiler can memoize the screen (try/finally + throw-in-try are bailouts).
async function loadNegotiationRequests(
  merchantId: string
): Promise<NegotiationRequest[]> {
  // NOTE: `negotiation_requests` has no top-level `current_price` column —
  // selecting it returns a 400 ("column does not exist") and breaks the whole
  // screen. The pre-offer price lives in `item_info.current_price` (single-item
  // offers only); whole-cart "total" offers carry no per-item price. Derive the
  // display price from item_info so the query stays valid.
  const { data, error } = await supabase
    .from('negotiation_requests')
    .select(
      'id, customer_id, type, status, offered_price, item_info, cart_snapshot, customer_email, customer_phone, created_at, evidence_url'
    )
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    ...row,
    // cart_snapshot is arbitrary client-supplied JSONB; coerce anything that
    // isn't an array to null so one malformed row can't crash the list on .map.
    cart_snapshot: Array.isArray(row.cart_snapshot) ? row.cart_snapshot : null,
    current_price: row.item_info?.current_price ?? null,
  })) as NegotiationRequest[];
}

export default function NegotiationsScreen() {
  const isFocused = useIsFocused();
  const { merchant, isLoading: isMerchantLoading } = useMerchant();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch negotiations using React Query
  const {
    data: requests = [],
    isLoading: isRequestsLoading,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ['negotiation_requests', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant not found');
      return loadNegotiationRequests(merchant.id);
    },
    enabled: isFocused && !!merchant?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    // Realtime updates are only received while this screen is focused, so
    // always refetch on (re)mount to surface negotiations submitted while the
    // queue was backgrounded/unmounted — cached rows still render instantly.
    refetchOnMount: 'always',
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'accepted' | 'rejected';
    }) => {
      if (!merchant?.id) throw new Error('Merchant not found');
      return apiClient<ResolveNegotiationResponse>(
        '/api/negotiations/resolve',
        {
          method: 'POST',
          body: JSON.stringify({ negotiationId: id, status }),
        }
      );
    },
    onSuccess: (result) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.notified) {
        Alert.alert(
          'Customer notified',
          result.channel === 'email'
            ? 'The decision email was accepted for delivery.'
            : 'The decision notification was sent.'
        );
      } else {
        Alert.alert(
          'Status updated',
          result.manualContactAvailable
            ? 'The customer was not notified automatically. Use Call or WhatsApp to follow up.'
            : 'The request was updated, but the customer has no available delivery channel.'
        );
      }
      // Return the invalidation promise so the mutation stays pending (and the
      // accept/reject actions stay disabled) until the refetched status lands,
      // preventing a stale-status flash before the queue reconciles.
      return queryClient.invalidateQueries({
        queryKey: ['negotiation_requests', merchant?.id],
      });
    },
    onError: (error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message =
        error instanceof Error ? error.message : 'Failed to update status';
      Alert.alert('Error', message);
      // Invalidate queries to ensure UI is in sync with server status
      queryClient.invalidateQueries({
        queryKey: ['negotiation_requests', merchant?.id],
      });
    },
  });

  useEffect(() => {
    if (fetchError) {
      console.error('Failed to load negotiation requests:', fetchError);
    }
  }, [fetchError]);

  const handleAction = (id: string, status: 'accepted' | 'rejected') => {
    if (updateStatusMutation.isPending) return; // Prevent double-submit
    updateStatusMutation.mutate({ id, status });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // Realtime updates subscription
  useEffect(() => {
    const merchantId = merchant?.id;
    if (!merchantId || !isFocused) return;
    let active = true;

    // Supabase Realtime supports Postgres change filters; scope by merchant to
    // avoid refetching every connected merchant on unrelated inserts.
    // Each effect owns a fresh channel: notification navigation can mount this
    // screen twice, and removal of a previous subscription is asynchronous.
    const channel = supabase
      .channel(`negotiation_updates:${merchantId}:${randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'negotiation_requests',
          filter: `merchant_id=eq.${merchantId}`,
        },
        () => {
          if (!active) return;
          queryClient.invalidateQueries({
            queryKey: ['negotiation_requests', merchantId],
          });
        }
      )
      .subscribe((status) => {
        if (!active || status !== 'SUBSCRIBED') return;
        // Recover missed changes only after Realtime is listening, including reconnects.
        queryClient.invalidateQueries({
          queryKey: ['negotiation_requests', merchantId],
        });
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [isFocused, merchant?.id, queryClient]);

  const loading = isMerchantLoading || (!!merchant?.id && isRequestsLoading);
  const actionLoadingId = updateStatusMutation.isPending
    ? (updateStatusMutation.variables?.id ?? null)
    : null;

  const renderItem = ({ item }: { item: NegotiationRequest }) => {
    return (
      <NegotiationCard
        actionLoading={actionLoadingId === item.id}
        actionsDisabled={actionLoadingId !== null}
        colors={colors}
        expanded={expandedId === item.id}
        item={item}
        onAction={handleAction}
        onOpenEvidence={openNegotiationEvidence}
        onOpenExternalUrl={openNegotiationExternalUrl}
        onToggleCart={(id) =>
          setExpandedId((current) => (current === id ? null : id))
        }
      />
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (fetchError) {
    const errorMessage = 'Failed to load negotiations. Please try again.';
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle" size={48} color={colors.error} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {errorMessage}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => {
            refetch();
          }}
        >
          <Ionicons name="refresh" size={18} color={colors.primary} />
          <Text style={[styles.retryText, { color: colors.primary }]}>
            Tap to retry
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlashList
        data={requests}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        extraData={`${expandedId ?? ''}:${actionLoadingId ?? ''}`}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons
              name="chatbubbles-outline"
              size={64}
              color={colors.border}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No Pending Negotiations
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: colors.textSecondary }]}
            >
              All quiet for now. New requests will appear here instantly.
            </Text>
          </View>
        }
      />
    </View>
  );
}
