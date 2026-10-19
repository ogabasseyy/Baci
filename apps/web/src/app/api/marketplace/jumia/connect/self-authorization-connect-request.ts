import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { jumiaAuthorizationCrypto } from '@/lib/jumia/authorization-crypto';
import { JumiaApiError } from '@/lib/jumia/jumia-api-error';
import {
  claimJumiaSelfAuthorizationDiscovery,
  createJumiaSelfAuthorizationDiscovery,
  preserveJumiaSelfAuthorizationDiscoveryAfterRotation,
} from '@/lib/jumia/self-authorization-discovery-store';
import type {
  jumiaSelfAuthorizationDiscoverySchema,
  jumiaSelfAuthorizationSelectionSchema,
} from '@/schemas/jumia/self-authorization';
import { claimJumiaDiscoveryCredentials } from './claim-jumia-discovery-credentials';
import { cleanupJumiaSelectionDiscovery } from './cleanup-jumia-selection-discovery';
import { setJumiaDiscoveryRecoveryHeader } from './jumia-discovery-recovery-response';
import { loadExistingJumiaShopIdsOrResponse } from './load-existing-jumia-shop-ids';
import { persistJumiaSelectionRotation } from './persist-jumia-selection-rotation';
import { releaseJumiaDiscoveryClaim } from './release-jumia-discovery-claim';
import { jumiaSelfAuthorizationHandler } from './self-authorization-handler';
import { validateJumiaSelfAuthorizationForConnect } from './validate-jumia-self-authorization-for-connect';

type DiscoveryBody = z.infer<typeof jumiaSelfAuthorizationDiscoverySchema>;
type SelectionBody = z.infer<typeof jumiaSelfAuthorizationSelectionSchema> & {
  connectionType: 'self_authorization';
};
function hashClientId(clientId: string): string {
  return crypto.createHash('sha256').update(clientId).digest('hex');
}

export async function handleJumiaSelfAuthorizationConnectRequest(args: {
  body: DiscoveryBody | SelectionBody;
  encryptionKey: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<NextResponse> {
  const { body, encryptionKey, merchantId, supabase } = args;
  try {
    if ('operation' in body) {
      const existingShopIdsResult = await loadExistingJumiaShopIdsOrResponse(
        supabase,
        merchantId
      );
      if (existingShopIdsResult instanceof NextResponse)
        return existingShopIdsResult;
      const existingShopIds = existingShopIdsResult;
      const clientKeyHash = hashClientId(body.clientId);
      let discoveryId: string | undefined;
      let discoveryClaim:
        | Awaited<ReturnType<typeof claimJumiaDiscoveryCredentials>>
        | undefined;
      let credentialsRotated = false;
      let rotatedCredentialsPersisted = false;
      let submittedCredentials = body.refreshToken
        ? { clientId: body.clientId, refreshToken: body.refreshToken }
        : undefined;
      // A submitted refresh token is an explicit reauthorization. Do not let
      // an older recovery ID replace credentials the merchant just entered.
      if (body.discoveryId && !body.refreshToken) {
        discoveryClaim = await claimJumiaDiscoveryCredentials({
          discoveryId: body.discoveryId,
          merchantId,
          clientKeyHash,
          encryptionKey,
          supabase,
        });
        if (!discoveryClaim) {
          return NextResponse.json(
            { error: 'Jumia shop discovery expired or is no longer valid' },
            { status: 409 }
          );
        }
        submittedCredentials = discoveryClaim.credentials;
        discoveryId = body.discoveryId;
      }
      if (!submittedCredentials) {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
      }
      let validated: Awaited<
        ReturnType<typeof validateJumiaSelfAuthorizationForConnect>
      >;
      try {
        validated = await validateJumiaSelfAuthorizationForConnect({
          clientKeyHash,
          discoveryId: discoveryClaim ? body.discoveryId : undefined,
          encryptionKey,
          merchantId,
          onCredentialsRotated: async ({ credentialCiphertext }) => {
            credentialsRotated = true;
            const fallbackDiscoveryId =
              await preserveJumiaSelfAuthorizationDiscoveryAfterRotation(
                supabase,
                {
                  ...(discoveryClaim && {
                    discoveryId: body.discoveryId,
                    claimToken: discoveryClaim.claimToken,
                  }),
                  merchantId,
                  clientKeyHash,
                  credentialCiphertext,
                }
              );
            if (fallbackDiscoveryId) discoveryId = fallbackDiscoveryId;
            rotatedCredentialsPersisted = true;
          },
          submittedCredentials,
          supabase,
        });
      } catch (error) {
        const retryableDiscoveryId =
          discoveryId && (!credentialsRotated || rotatedCredentialsPersisted)
            ? discoveryId
            : undefined;
        if (discoveryId || discoveryClaim) {
          if (discoveryClaim) {
            await releaseJumiaDiscoveryClaim({
              discoveryId: body.discoveryId ?? discoveryId ?? '',
              merchantId,
              claimToken: discoveryClaim.claimToken,
              supabase,
            });
          }
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Jumia shop discovery failed',
              ...(retryableDiscoveryId && {
                discoveryId: retryableDiscoveryId,
                retryable: true,
              }),
            },
            { status: 502 }
          );
        }
        throw error;
      }
      if (discoveryClaim) {
        await releaseJumiaDiscoveryClaim({
          discoveryId: body.discoveryId ?? discoveryId ?? '',
          merchantId,
          claimToken: discoveryClaim.claimToken,
          supabase,
        });
      }
      if (!discoveryId) {
        discoveryId = await createJumiaSelfAuthorizationDiscovery(supabase, {
          merchantId,
          clientKeyHash,
          credentialCiphertext: jumiaAuthorizationCrypto.encrypt(
            validated.credentials,
            encryptionKey,
            jumiaAuthorizationCrypto.buildAuthorizationContext(
              merchantId,
              clientKeyHash
            )
          ),
        });
      }
      return jumiaSelfAuthorizationHandler.discover({
        credentials: {
          clientId: submittedCredentials.clientId,
          refreshToken: submittedCredentials.refreshToken,
        },
        discoveryId,
        existingShopIds,
        validate: async () => validated,
      });
    }
    if (!('discoveryId' in body)) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const existingShopIdsResult = await loadExistingJumiaShopIdsOrResponse(
      supabase,
      merchantId
    );
    if (existingShopIdsResult instanceof NextResponse)
      return existingShopIdsResult;
    const existingShopIds = existingShopIdsResult;
    const clientKeyHash = hashClientId(body.clientId);
    const discoveryClaim = await claimJumiaSelfAuthorizationDiscovery(
      supabase,
      {
        discoveryId: body.discoveryId,
        merchantId,
        clientKeyHash,
      }
    );
    if (!discoveryClaim) {
      return NextResponse.json(
        { error: 'Jumia shop discovery is busy, expired, or no longer valid' },
        { status: 409 }
      );
    }
    let storedCredentials: ReturnType<typeof jumiaAuthorizationCrypto.decrypt>;
    try {
      storedCredentials = jumiaAuthorizationCrypto.decrypt(
        discoveryClaim.credentialCiphertext,
        encryptionKey,
        jumiaAuthorizationCrypto.buildAuthorizationContext(
          merchantId,
          clientKeyHash
        )
      );
    } catch (error) {
      await releaseJumiaDiscoveryClaim({
        discoveryId: body.discoveryId,
        merchantId,
        claimToken: discoveryClaim.claimToken,
        supabase,
      });
      throw error;
    }
    const expectedRotationVersionRef: { current?: number } = {};
    const recoveryDiscoveryIdRef: { current?: string } = {};
    try {
      const response = await jumiaSelfAuthorizationHandler.connect({
        credentials: {
          clientId: storedCredentials.clientId,
          refreshToken: storedCredentials.refreshToken,
        },
        encryptionKey,
        merchantId,
        existingShopIds,
        rpc: async (name, rpcArgs) => supabase.rpc(name, rpcArgs),
        selectedShopIds: body.selectedShopIds,
        validate: (credentials) =>
          validateJumiaSelfAuthorizationForConnect({
            clientKeyHash,
            discoveryId: body.discoveryId,
            encryptionKey,
            merchantId,
            onCredentialsRotated: async ({
              credentialCiphertext,
              expectedRotationVersion,
            }) => {
              await persistJumiaSelectionRotation({
                supabase,
                discoveryId: body.discoveryId,
                merchantId,
                clientKeyHash,
                claimToken: discoveryClaim.claimToken,
                credentialCiphertext,
                expectedRotationVersion,
                expectedRotationVersionRef,
                recoveryDiscoveryIdRef,
              });
            },
            submittedCredentials: credentials,
            supabase,
          }),
        encrypt: jumiaAuthorizationCrypto.encrypt,
        expectedRotationVersionRef,
      });
      const discoveryComplete = setJumiaDiscoveryRecoveryHeader(
        response,
        recoveryDiscoveryIdRef.current
      );
      if (!response.ok) {
        await releaseJumiaDiscoveryClaim({
          discoveryId: body.discoveryId,
          merchantId,
          claimToken: discoveryClaim.claimToken,
          supabase,
        });
        return response;
      }
      await cleanupJumiaSelectionDiscovery({
        supabase,
        discoveryId: body.discoveryId,
        merchantId,
        clientKeyHash,
        claimToken: discoveryClaim.claimToken,
        discoveryComplete,
      });
      return response;
    } catch (error) {
      await releaseJumiaDiscoveryClaim({
        discoveryId: body.discoveryId,
        merchantId,
        claimToken: discoveryClaim.claimToken,
        supabase,
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof JumiaApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}
