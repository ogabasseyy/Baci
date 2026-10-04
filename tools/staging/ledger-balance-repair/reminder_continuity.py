"""Historical comparison only; actual financial snapshots retain every reminder."""

import copy
import hashlib
import json


RELATION = 'savings_notifications.events'
PROOF_PATH = '/root/baci-reminder-continuity.sb522x47/proof.json'
PROOF_SHA = '55c52b6b8797b8b17b144fbd66dd59817fcc1efe5177a617b8616d7979907169'
HISTORICAL = dict(oid=44963, count=6,
    sha256='dc353d53717bb110bb9e67ef0f5d84d379ca5cfb48fffd2bc57b217f349c682f')
CURRENT = dict(oid=44963, count=8,
    sha256='d966b9b823312f5e11c706e8ca145afccff3d332bbd1ca023a199d923a91ce55')
WITNESS_SHA = '0e4a17aa3edad66c67f1aea18c564297a8abbc25e8fc1f748acb5d8272b4a1c2'
REMINDERS = [dict(id='914e9941-c9c1-44a1-9879-1de3e54ac365',
    rowSha256='1702c3dc690ed1025363fba35c6701067806a92ae68d7aa9d3db6864278b403e'),
    dict(id='b5c93597-2989-45d9-bed4-85ec220e4240',
    rowSha256='1ea111be1a6e082e5cfefe2017b28159fe5eb12fa0f085f2c30c5475f8c6778a')]
EXPECTED_PROOF = dict(kind='known-post-reboot-reminder-insertions', historicalRows=HISTORICAL,
    currentRows=CURRENT, currentWitnessSha256=WITNESS_SHA, database=dict(readOnly=True,
        systemIdentifier='7685292944002592802', reminders=REMINDERS,
        historicalCount=6, historicalSha256=HISTORICAL['sha256'],
        currentCount=8, currentSha256=CURRENT['sha256']))


def require(condition):
    if not condition:
        raise ValueError('ledger_reminder_continuity_refused')


def witness_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def normalize(previous, current, proof):
    require(type(proof) is dict and proof == EXPECTED_PROOF
        and previous['tableRows'][RELATION] == HISTORICAL
        and current['tableRows'][RELATION] == CURRENT
        and witness_digest(current['allowedTargetWitnesses'][RELATION]) == WITNESS_SHA)
    reduced = copy.deepcopy(current)
    reduced['tableRows'][RELATION] = copy.deepcopy(previous['tableRows'][RELATION])
    reduced['allowedTargetWitnesses'][RELATION] = copy.deepcopy(previous['allowedTargetWitnesses'][RELATION])
    return reduced
