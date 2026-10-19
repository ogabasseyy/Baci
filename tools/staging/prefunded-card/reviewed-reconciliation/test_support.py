import copy
from datetime import datetime, timezone
from unittest.mock import patch

import clone
import contract


SOURCE = """CREATE OR REPLACE FUNCTION prefunded_card.checkout_promote_collection(p_scope jsonb, p_selection jsonb, p_collection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  IF intent.phase='reconciliation_required' THEN
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  IF intent.phase NOT IN ('initializing','ready','pending') THEN
    RAISE EXCEPTION 'refused';
  END IF;
  RETURN '{}'::jsonb;
END
$function$
"""


def bundle(source=SOURCE):
    observed = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    collection = dict(intentId=contract.INTENT, reference='pvb-first-' + contract.INTENT,
                      providerTransactionId='900001', amountKobo=10000, currency='NGN', domain='test',
                      authorization=dict(authorizationCode='AUTH_fixture', signature='signature-fixture',
                          customerCode='CUS_fixture', email='fixture@example.test', reusable=True,
                          brand='visa', last4='4081', expiryMonth='12', expiryYear='2030'))
    return dict(source=source, scope=copy.deepcopy(contract.SCOPE), selection=copy.deepcopy(contract.SELECTION),
                collection=collection, preflight=dict(intentSha256='a' * 64, operationSha256='b' * 64,
                    protectedRowsSha256='c' * 64, permanentMetadataSha256='d' * 64,
                    routine=dict(oid=123, ownerOid=10, owner='postgres', acl=['postgres=X/postgres'],
                                 securityDefiner=True, configuration=['search_path=pg_catalog'], language='plpgsql')),
                proof=dict(verifiedAt=observed, paidAt='2026-10-02T13:05:25Z', responseSha256='e' * 64,
                    collectionSha256=contract.digest(collection), independentlyVerified=True,
                    status='success', domain='test', channel='card', reusable=True))


def fixture_pin(source=SOURCE):
    return patch.multiple(contract, SOURCE_SHA256=contract.sha256(source)), patch.multiple(
        clone, SOURCE_SHA256=contract.sha256(source))
