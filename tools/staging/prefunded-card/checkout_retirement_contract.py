import hashlib
import json
import re

from phone_email_contract import ACTOR, CUSTOMER, EMAIL, GOAL
from treasury_owner_contract import BUSINESS, DEADLINE, DEADLINE_EPOCH, INTEGRATION, MERCHANT, SOURCE, SYSTEM, TREASURY, Refused
from checkout_retirement_patches import render_patches


INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
REFERENCE = 'pvb-first-' + INTENT
PROTECTED = f"""encode(sha256(convert_to(jsonb_build_object(
  'goal',to_jsonb(goal),
  'ledger',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id) FROM piggyvest_savings_ledger.operations entry WHERE goal_id=goal.id),
  'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY posting.operation_id,posting.account) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id WHERE entry.goal_id=goal.id),
  'contributions',(SELECT jsonb_agg(to_jsonb(contribution) ORDER BY contribution.id) FROM public.customer_savings_contributions contribution WHERE goal_id=goal.id),
  'treasury',to_jsonb(treasury)-ARRAY['reserved_kobo','verified_at'],
  'identity',(SELECT to_jsonb(identity) FROM prefunded_card.treasury_identities identity WHERE treasury_binding_id=treasury.id)
  )::text,'UTF8')),'hex')"""
JOINS = f"""FROM public.customer_savings_goals goal
  JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
  JOIN prefunded_card.checkout_intents intent ON intent.id='{INTENT}' AND intent.goal_id=goal.id
  JOIN prefunded_card.operations operation ON operation.id=intent.operation_id
  JOIN prefunded_card.treasury_bindings treasury ON treasury.id=intent.treasury_binding_id
  WHERE goal.id='{GOAL}' AND goal.customer_id='{CUSTOMER}' AND goal.merchant_id='{MERCHANT}'
    AND customer.user_id='{ACTOR}' AND customer.email='{EMAIL}'
    AND treasury.id='{TREASURY}' AND treasury.integration_id='{INTEGRATION}' AND treasury.merchant_id='{MERCHANT}'
    AND treasury.expected_business_id='{BUSINESS}' AND treasury.source_wallet_id='{SOURCE}'
    AND treasury.authorized_login='prefunded_treasury_operator' AND treasury.currency='NGN'
    AND treasury.enabled AND treasury.verified_available_kobo=10000 AND treasury.consumed_kobo=0
    AND EXISTS(SELECT 1 FROM prefunded_card.treasury_identities identity WHERE treasury_binding_id=treasury.id
      AND opening_available_kobo=10000 AND source_wallet_id=treasury.source_wallet_id)
    AND intent.customer_id=customer.id AND intent.merchant_id=customer.merchant_id AND intent.actor_id=customer.user_id
    AND operation.customer_id=customer.id AND operation.merchant_id=customer.merchant_id AND operation.goal_id=goal.id"""


def snapshot_sql():
    return f"""SELECT jsonb_build_object(
      'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
      'database',current_database(),'withinDeadline',clock_timestamp()<to_timestamp({DEADLINE_EPOCH}),
      'intentId',intent.id,'phase',intent.phase,'amountKobo',intent.amount_kobo,'reference',intent.reference,
      'requestFingerprint',intent.request_fingerprint,'principalKobo',goal.current_amount*100,
      'reservedKobo',treasury.reserved_kobo,'consumedKobo',treasury.consumed_kobo,
      'hasCheckoutUrl',intent.session_authorization_url IS NOT NULL,
      'collectionStatus',operation.collection_status,'transferStatus',operation.transfer_status,
      'projectionStatus',operation.projection_status,'operationCount',(SELECT count(*) FROM prefunded_card.operations),
      'intentCount',(SELECT count(*) FROM prefunded_card.checkout_intents),
      'protected',{PROTECTED}) {JOINS};"""


def validate(report, *, retired=False):
    expected = dict(systemIdentifier=SYSTEM, database='postgres', withinDeadline=True, intentId=INTENT,
                    phase='retired_unconfirmed' if retired else 'pending', amountKobo=10000,
                    reference=REFERENCE, principalKobo=10000, reservedKobo=0 if retired else 10000,
                    consumedKobo=0, hasCheckoutUrl=False, collectionStatus='pending', transferStatus='not_started',
                    projectionStatus='unapplied', operationCount=1, intentCount=1)
    if (not isinstance(report, dict) or any((type(report.get(key)) is not type(value)
            and not (key == 'principalKobo' and type(report.get(key)) in (int, float))) or report[key] != value
            for key, value in expected.items()) or any(not isinstance(report.get(key), str) or
            not re.fullmatch('[a-f0-9]{64}', report[key]) for key in ('protected', 'requestFingerprint'))):
        raise Refused('Exact approved checkout state differs')


def approval(report, evidence):
    validate(report)
    return dict(deployment='staging', integrationId=INTEGRATION, merchantId=MERCHANT, treasuryBindingId=TREASURY,
                businessId=BUSINESS, systemIdentifier=SYSTEM, expiresAt=DEADLINE, intentId=INTENT,
                customerId=CUSTOMER, actorId=ACTOR, goalId=GOAL, amountKobo=10000, reference=REFERENCE,
                requestFingerprint=report['requestFingerprint'], evidence=evidence)


def render_transaction(directory, report, evidence, *, rehearsal=False):
    value = approval(report, evidence)
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':')).replace("'", "''")
    schema = (directory / 'checkout-retirement-storage.sql').read_text()
    mutation = (directory / 'checkout-retirement-apply.sql').read_text()
    patches = render_patches(directory)
    sql = f"""BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO $identity$ BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'postgres'
    OR inet_client_addr() IS NOT NULL OR (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}'
    OR clock_timestamp()>=to_timestamp({DEADLINE_EPOCH}) THEN
    RAISE EXCEPTION 'retirement deployment identity denied' USING ERRCODE='42501'; END IF;
END $identity$;
LOCK TABLE prefunded_card.treasury_bindings,prefunded_card.checkout_intents,prefunded_card.operations,
  prefunded_card.dispatch_queue,prefunded_card.provider_evidence,piggyvest_savings_ledger.operations,
  piggyvest_savings_ledger.postings,public.customer_savings_goals,public.customer_savings_contributions
  IN ACCESS EXCLUSIVE MODE;
DO $baseline$ BEGIN
  IF NOT EXISTS(SELECT 1 {JOINS} AND {PROTECTED}='{report['protected']}'
    AND goal.current_amount=100 AND treasury.reserved_kobo=10000)
    OR (SELECT count(*) FROM prefunded_card.operations)<>1 OR (SELECT count(*) FROM prefunded_card.checkout_intents)<>1 THEN
    RAISE EXCEPTION 'retirement baseline changed' USING ERRCODE='42501'; END IF;
END $baseline$;
{schema}
{patches}
{mutation}
SELECT prefunded_card.retire_unconfirmed_checkout('{encoded}'::jsonb);
DO $postflight$ BEGIN
  IF NOT EXISTS(SELECT 1 {JOINS} AND {PROTECTED}='{report['protected']}' AND goal.current_amount=100
    AND treasury.reserved_kobo=0 AND intent.phase='retired_unconfirmed' AND operation.collection_status='pending'
    AND operation.transfer_status='not_started' AND operation.projection_status='unapplied') THEN
    RAISE EXCEPTION 'retirement preservation failed' USING ERRCODE='42501'; END IF;
END $postflight$;
"""
    return sql + ('ROLLBACK;' if rehearsal else 'COMMIT;')


def digest(content):
    return hashlib.sha256(content).hexdigest()
