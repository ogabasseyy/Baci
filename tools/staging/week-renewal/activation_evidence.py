from renewal_contract import SYSTEM, TARGET_EPOCH, Refused


INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'


def financial_fences(database):
    if (database.get('systemIdentifier') != SYSTEM or database.get('readOnly') is not True
            or database.get('principalKobo') != 10000 or database.get('retirementAuditRows') != 1):
        raise Refused('fresh-financial-fences')
    treasury = database.get('treasury', {})
    expected = {'id': 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57', 'enabled': True,
                'verifiedAvailableKobo': 10000, 'reservedKobo': 0, 'consumedKobo': 0}
    if treasury != expected:
        raise Refused('fresh-treasury-fences')
    intents, operations = database.get('intents'), database.get('operations')
    if (not isinstance(intents, list) or len(intents) != 1
            or intents[0].get('id') != INTENT or intents[0].get('phase') != 'retired_unconfirmed'
            or intents[0].get('amountKobo') != 10000 or not isinstance(operations, list)
            or operations != [{'id': INTENT, 'retired': True, 'transfer': 'not_started',
                               'collection': 'pending', 'projection': 'unapplied'}]):
        raise Refused('fresh-retirement-fences')
    return {'principalKobo': 10000, 'treasuryApprovedKobo': 10000,
            'treasuryReservedKobo': 0, 'treasuryConsumedKobo': 0, 'oldIntentRetained': True}


def funding_role(report):
    if report.get('systemIdentifier') != SYSTEM or report.get('readOnly') is not True:
        raise Refused('funding-role-physical-database')
    role = report.get('role')
    if not isinstance(role, dict) or role.get('name') != 'piggyvest_staging_provisioner':
        raise Refused('funding-role-identity')
    if role.get('present') is not True:
        return {'present': False, 'coversRequestedDeadline': False, 'credentialsChanged': False}
    if (any(role.get(name) is not False for name in
            ('superuser', 'bypassRls', 'createRole', 'createDb', 'replication', 'unsafeMembership'))
            or role.get('memberships') not in (None, [])
            or type(role.get('login')) is not bool or type(role.get('inherits')) is not bool):
        raise Refused('funding-role-unsafe-authority')
    expiry = role.get('expiresAtEpoch')
    if expiry is not None and type(expiry) is not int:
        raise Refused('funding-role-expiry')
    return {'present': True, 'login': role['login'], 'inherits': role['inherits'],
            'expiresAtEpoch': expiry, 'coversRequestedDeadline': role['login'] and
            expiry is not None and expiry >= TARGET_EPOCH,
            'unsafeAuthority': False, 'credentialsChanged': False,
            'memberships': role.get('memberships'), 'functions': report.get('functions')}


def container_identity(value, identity, service):
    expected = identity['containers'][service]
    labels = value.get('Config', {}).get('Labels') or {}
    matches = [network for network in value.get('NetworkSettings', {}).get('Networks', {}).values()
               if network.get('NetworkID') == identity['networks']['database']['id']]
    if (value.get('Id') != expected['id'] or value.get('State', {}).get('Running') is not True
            or value.get('State', {}).get('Restarting') is not False
            or labels.get('com.docker.compose.project') != 'baci-isolated-savings'
            or labels.get('com.docker.compose.service') != service or len(matches) != 1
            or matches[0].get('IPAddress') != expected['ip']
            or matches[0].get('EndpointID') != expected['endpointId']):
        raise Refused('gateway-upstream-identity')
    return {'id': expected['id'], 'ip': expected['ip'], 'endpointId': expected['endpointId'],
            'running': True, 'composeIdentityVerified': True}
