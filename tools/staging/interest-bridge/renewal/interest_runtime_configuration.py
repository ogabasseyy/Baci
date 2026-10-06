import hashlib
import re
from runtime_replay_configuration import prepare_replay_configuration
from treasury_owner_contract import BUSINESS, HOST, INTEGRATION, Refused, SYSTEM


REVIEWED_DEADLINE_EPOCH = 1791302350


def build_interest_configuration(original, signing_keys, prepared, now=None):
    try:
        connection = prepared['background']['database']['treasury']
        worker = prepared['background']['worker']
        expected = dict(environment='staging', transport='tls', host=HOST, expectedHost=HOST,
                        port=5432, login='prefunded_treasury_operator',
                        expectedLogin='prefunded_treasury_operator', database='postgres',
                        expectedDatabase='postgres', expectedSystemId=SYSTEM,
                        expectedProjectId='baci-isolated-savings', actualProjectId='baci-isolated-savings',
                        storageApproved=True)
        if (any(type(connection.get(name)) is not type(value) or connection.get(name) != value
                for name, value in expected.items())
                or worker['integrationId'] != INTEGRATION or worker['businessId'] != BUSINESS
                or worker['expectedSystemId'] != SYSTEM):
            raise ValueError()
        ca = connection['certificateAuthority']
        password = connection['password']
        if (not isinstance(ca, str) or not 1 <= len(ca) <= 65536
                or not ca.startswith('-----BEGIN CERTIFICATE-----')
                or not ca.rstrip().endswith('-----END CERTIFICATE-----')
                or hashlib.sha256(ca.encode()).hexdigest() != prepared['expected']['certificateAuthoritySha256']
                or not isinstance(password, str) or not re.fullmatch(r'[A-Za-z0-9_-]{64}', password)):
            raise ValueError()
        result = prepare_replay_configuration(original, signing_keys, original['receiptKey'],
                                              now=now, deadline=REVIEWED_DEADLINE_EPOCH)
        result['financialDatabase'] = dict(host=HOST, port=5432, database='postgres',
                                          role='prefunded_treasury_operator', password=password,
                                          integrationId=INTEGRATION, businessId=BUSINESS, ssl={'ca': ca})
        return result
    except (ValueError, TypeError, KeyError, AttributeError):
        raise Refused('Interest runtime configuration refused') from None
