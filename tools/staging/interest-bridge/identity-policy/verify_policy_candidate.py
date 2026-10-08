import hashlib
import json
from datetime import datetime

from policy_contract import DEADLINE, FIELDS, FUNDED_GOAL_WALLET, SCOPE, SHA256, validate_evidence
from resolve_customer_identity import resolve_customer_identity


def _time(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('timestamp')
    parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    if parsed.isoformat(timespec='seconds').replace('+00:00', 'Z') != value:
        raise ValueError('timestamp')
    return parsed


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def verify_policy_candidate(bundle, reviewed_pins, now):
    result = {'status': 'refused', 'changesMade': False, 'liveWritesAllowed': False,
              'providerIdMappingApproved': False,
              'missingEvidence': [], 'refusals': [], 'candidate': None}

    def refuse(code):
        if code not in result['refusals']:
            result['refusals'].append(code)

    if (not isinstance(bundle, dict) or set(bundle) != {'scope', 'expiresAt', 'evidence'}
            or bundle.get('scope') != SCOPE):
        refuse('staging_scope_invalid')
        return result
    try:
        checked_at = _time(now)
        expiry = _time(bundle['expiresAt'])
        if not checked_at < expiry <= _time(DEADLINE):
            raise ValueError('deadline')
    except (ValueError, TypeError, OverflowError):
        refuse('deadline_invalid')
        return result
    if not isinstance(reviewed_pins, dict) or len(reviewed_pins) > 32:
        refuse('review_registry_invalid')
        return result
    for artifact, review in reviewed_pins.items():
        if (not isinstance(artifact, str) or not isinstance(review, dict)
                or set(review) != {'kind', 'sha256'} or not isinstance(review['kind'], str)
                or review['kind'] not in FIELDS
                or not isinstance(review['sha256'], str)
                or SHA256.fullmatch(review['sha256']) is None):
            refuse('review_registry_invalid')
            return result
    evidence = bundle.get('evidence')
    if not isinstance(evidence, list) or len(evidence) > 32:
        refuse('evidence_bound_invalid')
        return result
    by_kind = {}
    seen_artifacts = set()
    for record in evidence:
        if not validate_evidence(record):
            refuse('evidence_schema_invalid')
            continue
        kind, artifact = record['kind'], record['artifactId']
        if kind in by_kind or artifact in seen_artifacts:
            refuse('evidence_ambiguous')
            continue
        seen_artifacts.add(artifact)
        review = reviewed_pins.get(artifact)
        if review != {'kind': kind, 'sha256': _digest(record)}:
            refuse(f'{kind}_unreviewed_or_changed')
            continue
        if record['environment'] != 'staging' or record['businessId'] != SCOPE['businessId']:
            refuse(f'{kind}_scope_mismatch')
            continue
        try:
            if not _time(record['observedAt']) <= checked_at < expiry <= _time(record['validUntil']):
                raise ValueError('validity')
        except (ValueError, TypeError, OverflowError):
            refuse(f'{kind}_validity_invalid')
            continue
        by_kind[kind] = record
    required = {'wallet', 'wallet_eligibility', 'goal_binding', 'payout_routing', 'owner_opt_in', 'global_split'}
    direct_complete = {'registration', 'customer_alias'} <= set(by_kind)
    history_complete = {'historical_receipt', 'historical_wallet'} <= set(by_kind)
    if not direct_complete and not history_complete:
        required.update({'customer_identity_one_complete_path'})
    result['missingEvidence'] = sorted(required - set(by_kind))
    if direct_complete or history_complete:
        identity, identity_refusals = resolve_customer_identity(by_kind)
        for code in identity_refusals:
            refuse(code)
        if identity is not None and 'wallet' in by_kind:
            if identity['apiCustomerId'] != by_kind['wallet']['apiCustomerId']:
                refuse('api_customer_exact_link_missing')
    if 'wallet' in by_kind:
        if by_kind['wallet']['interestEnabled'] is not True:
            refuse('wallet_interest_not_enabled')
        if ('goal_binding' in by_kind
                and by_kind['wallet']['publicWalletId'] != by_kind['goal_binding']['publicWalletId']):
            refuse('goal_wallet_exact_link_missing')
        if by_kind['wallet']['publicWalletId'] != FUNDED_GOAL_WALLET:
            refuse('new_goal_and_provisioned_binding_required')
    if result['missingEvidence'] or result['refusals']:
        return result
    identity, identity_refusals = resolve_customer_identity(by_kind)
    for code in identity_refusals:
        refuse(code)
    if identity is None:
        return result
    wallet, binding, routing, opt_in, split = (
        by_kind[kind] for kind in ('wallet', 'goal_binding', 'payout_routing', 'owner_opt_in', 'global_split'))
    eligibility = by_kind['wallet_eligibility']
    if (eligibility['eligibleForCustomerInterest'] is not True
            or any(eligibility[key] != wallet[key] for key in
                   ('publicWalletId', 'faasWalletId', 'apiCustomerId'))):
        refuse('wallet_customer_interest_eligibility_unproven')
    if identity['apiCustomerId'] != wallet['apiCustomerId']:
        refuse('api_customer_exact_link_missing')
    for record, kind in ((binding, 'goal_binding'), (opt_in, 'owner_opt_in')):
        if any(record[key] != SCOPE[key] for key in
               ('integrationId', 'merchantId', 'appCustomerId', 'goalId')):
            refuse(f'{kind}_ownership_mismatch')
    if not wallet['publicWalletId'] == binding['publicWalletId'] == routing['publicWalletId'] == opt_in['publicWalletId']:
        refuse('goal_wallet_exact_link_missing')
    if wallet['faasWalletId'] != routing['faasWalletId']:
        refuse('faas_wallet_exact_link_missing')
    if not identity['webhookCustomerId'] == binding['webhookCustomerId'] == routing['webhookCustomerId']:
        refuse('webhook_customer_exact_link_missing')
    if wallet['interestEnabled'] is not True:
        refuse('wallet_interest_not_enabled')
    if binding['bindingEnabled'] is not True or binding['principalKobo'] != 10000:
        refuse('existing_binding_or_principal_changed')
    if binding['systemIdentifier'] != SCOPE['systemIdentifier']:
        refuse('app_database_identity_mismatch')
    if opt_in['accepted'] is not True:
        refuse('owner_opt_in_missing')
    namespace_field = {'public': 'publicWalletId', 'faas': 'faasWalletId'}.get(routing['sourceNamespace'])
    if namespace_field is None or routing['sourceWalletId'] != wallet[namespace_field]:
        refuse('payout_source_exact_mapping_missing')
    if (split['customerAnnualRateBps'] != 900 or split['businessAnnualRateBps'] != 300
            or split['customerNetTreatment'] != 'full_customer_net_no_resplit'):
        refuse('global_split_attestation_invalid')
    if result['refusals']:
        return result
    policy = {
        'goal_id': SCOPE['goalId'], 'integration_id': SCOPE['integrationId'],
        'merchant_id': SCOPE['merchantId'], 'customer_id': SCOPE['appCustomerId'],
        'provider_business_id': SCOPE['businessId'],
        'provider_customer_id': identity['webhookCustomerId'],
        'interest_source_wallet_id': routing['sourceWalletId'],
        'payout_wallet_id': routing['payoutWalletId'], 'interest_enabled': True,
        'eligibility_evidence': 'identity-policy:' + _digest(by_kind),
        'policy_reference': opt_in['policyReference'], 'expires_at': bundle['expiresAt'],
        'enabled': False,
    }
    result.update(status='prepared_inactive', candidate={
        'policy': policy, 'idempotencyKey': 'identity-policy:' + _digest(policy),
        'evidenceSha256': _digest(by_kind), 'principalKobo': 10000,
        'pendingAccrualSpendable': False, 'customerNetTreatment': split['customerNetTreatment'],
        'customerAnnualRateBps': 900, 'businessAnnualRateBps': 300,
    })
    return result
