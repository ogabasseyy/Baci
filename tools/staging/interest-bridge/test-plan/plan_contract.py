import hashlib
import json
import re
from datetime import datetime, timezone

from plan_constants import DEADLINE, IDENTITY_SHA, OLD_FAAS, OLD_WALLET, PLAN_KEY, SCOPE, TITLE


SHA256 = re.compile(r'^[a-f0-9]{64}$')
MD5 = re.compile(r'^[a-f0-9]{32}$')
TOKEN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
PROVIDER_UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _shape(value, fields, code):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise ValueError(code)


def _time(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('timestamp')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo != timezone.utc:
        raise ValueError('timestamp')
    return result


def _token(value):
    return isinstance(value, str) and TOKEN.fullmatch(value) is not None


def _routing(routing):
    _shape(routing, 'provenance artifactSha256 reference sourceNamespace sourceWalletId '
           'destinationNamespace payoutWalletId sourceSemantics destinationSemantics '
           'providerCustomerNamespace providerCustomerId', 'routing-shape')
    source_fields = {'public': 'publicWalletId', 'faas': 'faasWalletId'}
    customer_fields = {'api': 'apiCustomerId', 'webhook': 'webhookCustomerId'}
    if (routing['provenance'] not in ('provider_documented_mapping', 'provider_signed_payout_mapping',
                                    'provider_authenticated_readback_and_documented_field_mapping')
            or not isinstance(routing['artifactSha256'], str)
            or SHA256.fullmatch(routing['artifactSha256']) is None
            or not _token(routing['reference']) or not _token(routing['sourceNamespace'])
            or routing['sourceNamespace'] not in source_fields
            or routing['sourceWalletId'] != SCOPE[source_fields[routing['sourceNamespace']]]
            or routing['destinationNamespace'] not in ('public', 'faas', 'provider_ledger_uuid')
            or not _token(routing['providerCustomerNamespace'])
            or routing['providerCustomerNamespace'] not in customer_fields
            or routing['providerCustomerId'] != SCOPE[customer_fields[routing['providerCustomerNamespace']]]
            or not _token(routing['payoutWalletId'])
            or routing['payoutWalletId'] in (OLD_WALLET, OLD_FAAS)
            or routing['sourceSemantics'] != 'interest_earning_wallet'
            or routing['destinationSemantics'] != 'customer_net_payout_wallet'):
        raise ValueError('payout-namespace-unproven')
    if (routing['destinationNamespace'] == 'provider_ledger_uuid'
            and PROVIDER_UUID.fullmatch(routing['payoutWalletId']) is None):
        raise ValueError('payout-namespace-unproven')
    return {'sourceWalletId': routing['sourceWalletId'], 'payoutWalletId': routing['payoutWalletId'],
            'payoutProviderCustomerId': routing['providerCustomerId']}


def validate_approval(approval, snapshot, wallet, now, goal_only=False):
    _shape(approval, 'scope expiresAt identitySha256 schemaMd5 stateMd5 snapshotObservedAt '
           'optIn routing eligibility split', 'approval-shape')
    if approval['scope'] != SCOPE or approval['expiresAt'] != DEADLINE:
        raise ValueError('approval-scope')
    if approval['identitySha256'] != IDENTITY_SHA:
        raise ValueError('identity-pin')
    if now >= _time(DEADLINE):
        raise ValueError('deadline')
    for field in ('schemaMd5', 'stateMd5'):
        if (not isinstance(approval[field], str) or not MD5.fullmatch(approval[field])
                or approval[field] != snapshot.get(field)):
            raise ValueError('snapshot-drift')
    if approval['snapshotObservedAt'] != snapshot.get('observedAt'):
        raise ValueError('snapshot-identity')
    snapshot_age = (now - _time(approval['snapshotObservedAt'])).total_seconds()
    if not 0 <= snapshot_age <= 900:
        raise ValueError('snapshot-stale')
    if snapshot.get('systemIdentifier') != SCOPE['systemIdentifier']:
        raise ValueError('physical-identity')
    _shape(wallet, 'scope retrievedAt responseSha256 balanceKobo interestEnabled withdrawalCount', 'wallet-shape')
    if (wallet['scope'] != SCOPE or wallet['interestEnabled'] is not True
            or type(wallet['balanceKobo']) is not int or wallet['balanceKobo'] != 0
            or type(wallet['withdrawalCount']) is not int or not 0 <= wallet['withdrawalCount'] <= 4
            or not isinstance(wallet['responseSha256'], str)
            or SHA256.fullmatch(wallet['responseSha256']) is None
            or not 0 <= (now - _time(wallet['retrievedAt'])).total_seconds() <= 90):
        raise ValueError('wallet-not-fresh-empty-enabled')
    opt_in = approval['optIn']
    _shape(opt_in, 'accepted interestEnabled termsAccepted nonWithdrawableAccepted '
           'acceptedAt reference', 'opt-in-shape')
    if (any(opt_in[field] is not True for field in
            ('accepted', 'interestEnabled', 'termsAccepted', 'nonWithdrawableAccepted'))
            or not _token(opt_in['reference']) or not _time(opt_in['acceptedAt']) <= now
            or _time(opt_in['acceptedAt']) < _time('2026-10-02T00:00:00Z')):
        raise ValueError('owner-opt-in')
    if goal_only and approval['routing'] is not None:
        raise ValueError('goal-only-routing-must-be-absent')
    routing = {} if goal_only else _routing(approval['routing'])
    eligibility = approval['eligibility']
    _shape(eligibility, 'eligible provenance artifactSha256 reference', 'eligibility-shape')
    if (eligibility['eligible'] is not True or not _token(eligibility['reference'])
            or eligibility['provenance'] != 'provider_authenticated_wallet_get'
            or not isinstance(eligibility['artifactSha256'], str)
            or SHA256.fullmatch(eligibility['artifactSha256']) is None):
        raise ValueError('eligibility-unproven')
    split = approval['split']
    _shape(split, 'scope customerAnnualRateBps businessAnnualRateBps customerNetTreatment '
           'provenance artifactSha256 reference', 'split-shape')
    if (split['scope'] != 'business_global' or type(split['customerAnnualRateBps']) is not int
            or split['provenance'] != 'user_forwarded_provider_confirmation'
            or type(split['businessAnnualRateBps']) is not int
            or split['customerAnnualRateBps'] != 900 or split['businessAnnualRateBps'] != 300
            or split['customerNetTreatment'] != 'full_customer_net_no_resplit'
            or not _token(split['reference']) or not isinstance(split['artifactSha256'], str)
            or SHA256.fullmatch(split['artifactSha256']) is None):
        raise ValueError('business-global-split-unproven')
    return {
        **SCOPE, **routing, 'goalOnly': goal_only, 'expiresAt': DEADLINE, 'planKey': PLAN_KEY, 'title': TITLE,
        'schemaMd5': approval['schemaMd5'], 'stateMd5': approval['stateMd5'],
        'providerRetrievedAt': wallet['retrievedAt'], 'walletResponseSha256': wallet['responseSha256'],
        'approvalSha256': digest(approval), 'acceptedAt': opt_in['acceptedAt'],
        'eligibilityReference': eligibility['reference'], 'policyReference': opt_in['reference'],
        'metadata': {'stagingTestPlanKey': PLAN_KEY, 'interestOptIn': True,
                     'definitionSha256': digest({key: approval[key] for key in
                         ('scope', 'expiresAt', 'identitySha256', 'optIn', 'routing', 'eligibility', 'split')}),
                     'identitySha256': IDENTITY_SHA,
                     'policyReference': opt_in['reference'], 'prefundingKobo': 0},
    }
