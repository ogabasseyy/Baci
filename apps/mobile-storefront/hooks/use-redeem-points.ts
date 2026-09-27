import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import { calculateCommerce } from '@/lib/commerce-brain';
import { CONFIG } from '@/lib/config';
import {
  clearPendingLoyaltyRedemptionId,
  getOrCreatePendingLoyaltyRedemptionId,
  getPendingLoyaltyRedemptionStorageKey,
  getReusablePendingLoyaltyRedemptionId,
} from '@/lib/loyalty-redemption-idempotency';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import {
  getRedeemPointValidationError,
  redemptionBalanceSnapshotKey,
} from './loyalty-redemption-utils';
import {
  type WalletQueryData,
  type WalletQueryKey,
  walletKeys,
} from './wallet-query';

const RedeemLoyaltyRpcResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({
    success: z.literal(true),
    wallet_credited: z.number().finite(),
    points_deducted: z.number().finite(),
    new_points_balance: z.number().finite(),
    new_wallet_balance: z.number().finite(),
  }),
  z.strictObject({
    success: z.literal(false),
    error: z.string().optional(),
  }),
]);

export function useRedeemPoints() {
  const queryClient = useQueryClient();
  const redemptionAttemptIdsRef = useRef(new Map<string, string>());
  const redemptionBalanceSnapshotsRef = useRef(new Map<string, number>());
  const { customer, merchantId, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      user: state.user,
    }))
  );
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;

  return useMutation({
    mutationFn: async (points: number) => {
      if (!customer?.id || !activeMerchantId) {
        throw new Error('Authentication required. Please sign in again.');
      }

      const validationError = getRedeemPointValidationError(points);
      if (validationError) {
        throw new Error(validationError);
      }

      const customerId = customer.id;
      const currentMerchantId = activeMerchantId;
      const balanceSnapshotKey = redemptionBalanceSnapshotKey({
        customerId,
        merchantId: currentMerchantId,
        points,
      });
      const attemptId =
        redemptionAttemptIdsRef.current.get(balanceSnapshotKey) ??
        Crypto.randomUUID();
      redemptionAttemptIdsRef.current.set(balanceSnapshotKey, attemptId);

      const cachedData = queryClient.getQueryData<WalletQueryData>(
        walletKeys.data({
          merchantId: currentMerchantId,
          ownerId: customerId,
        })
      );
      const currentPoints =
        redemptionBalanceSnapshotsRef.current.get(balanceSnapshotKey) ??
        cachedData?.wallet?.loyalty_points ??
        0;
      const reusablePendingRedemption =
        await getReusablePendingLoyaltyRedemptionId({
          attemptId,
          customerId,
          merchantId: currentMerchantId,
          points,
        });

      if (points > currentPoints && !reusablePendingRedemption) {
        throw new Error('Insufficient loyalty points');
      }

      const commerceCurrentPoints = reusablePendingRedemption
        ? Math.max(currentPoints, reusablePendingRedemption.pointsBeforeRedeem)
        : currentPoints;

      const result = await calculateCommerce('redeem_loyalty', {
        points,
        currentPoints: commerceCurrentPoints,
        pointsToNairaRate: 1,
      });

      if (!result.success) {
        throw new Error(result.error || 'Redemption failed');
      }

      const { redemptionId } =
        reusablePendingRedemption ??
        (await getOrCreatePendingLoyaltyRedemptionId({
          attemptId,
          createId: Crypto.randomUUID,
          customerId,
          currentPoints,
          merchantId: currentMerchantId,
          points,
        }));

      const { data: rpcData, error } = await supabase.rpc(
        'redeem_loyalty_points',
        {
          p_customer_id: customerId,
          p_merchant_id: currentMerchantId,
          p_points: points,
          p_redemption_id: redemptionId,
          p_wallet_credit: result.walletCredit,
        }
      );

      if (error) {
        throw error;
      }

      const parsedRpc = RedeemLoyaltyRpcResponseSchema.safeParse(rpcData);
      if (!parsedRpc.success) {
        throw new Error('Invalid redeem_loyalty_points RPC response');
      }

      if (!parsedRpc.data.success) {
        throw new Error(parsedRpc.data.error || 'Redemption failed');
      }

      return {
        ...result,
        walletCredit: parsedRpc.data.wallet_credited,
        pointsRedeemed: parsedRpc.data.points_deducted,
        remainingPoints: parsedRpc.data.new_points_balance,
      };
    },
    onMutate: async (points) => {
      const walletOwnerId = customer?.id ?? user?.id ?? '';
      if (!walletOwnerId || !activeMerchantId) {
        return {
          previousData: undefined,
          queryKey: undefined,
          redemptionKey: undefined,
          snapshotKey: undefined,
        };
      }

      if (getRedeemPointValidationError(points)) {
        return {
          previousData: undefined,
          queryKey: undefined,
          redemptionKey: undefined,
          snapshotKey: undefined,
        };
      }

      const snapshotKey = customer?.id
        ? redemptionBalanceSnapshotKey({
            customerId: customer.id,
            merchantId: activeMerchantId,
            points,
          })
        : undefined;
      const redemptionKey = customer?.id
        ? getPendingLoyaltyRedemptionStorageKey({
            customerId: customer.id,
            merchantId: activeMerchantId,
            points,
          })
        : undefined;

      const queryKey: WalletQueryKey = walletKeys.data({
        merchantId: activeMerchantId,
        ownerId: walletOwnerId,
      });

      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<WalletQueryData>(queryKey);

      if (previousData && previousData.wallet.loyalty_points < points) {
        // Skip the optimistic decrement when cached points are insufficient; the RPC still validates the mutation.
        return { previousData, queryKey, redemptionKey, snapshotKey };
      }

      if (previousData && snapshotKey) {
        redemptionBalanceSnapshotsRef.current.set(
          snapshotKey,
          previousData.wallet.loyalty_points
        );
      }

      if (previousData) {
        queryClient.setQueryData<WalletQueryData>(queryKey, {
          ...previousData,
          wallet: {
            ...previousData.wallet,
            loyalty_points: previousData.wallet.loyalty_points - points,
          },
        });
      }

      return { previousData, queryKey, redemptionKey, snapshotKey };
    },
    onSuccess: async (_data, _points, context) => {
      if (context?.redemptionKey) {
        await clearPendingLoyaltyRedemptionId(context.redemptionKey);
      }

      if (context?.snapshotKey) {
        redemptionAttemptIdsRef.current.delete(context.snapshotKey);
      }
    },
    onError: (_err, _points, context) => {
      if (context?.previousData && context.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
    },
    onSettled: (_data, _error, _points, context) => {
      if (context?.snapshotKey) {
        redemptionBalanceSnapshotsRef.current.delete(context.snapshotKey);
      }

      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      }
    },
  });
}
