import importlib.util
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('complete_candidate_artifact', HERE / 'artifact.py')
artifact = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(artifact)
contract = artifact.contract


def _claim_proof(token, proof, reviewed_pin, now):
    contract.require(contract.hex_digest(reviewed_pin) and isinstance(proof, dict)
                     and contract.digest(proof) == reviewed_pin, 'parent_claim_proof_pin_refused')
    contract.require(set(proof) == {'tokenSha256', 'signatureVerified', 'claims'}
                     and isinstance(token, str) and 1 <= len(token.encode()) <= 8192
                     and proof['tokenSha256'] == contract.sha(token.encode())
                     and proof['signatureVerified'] is True, 'parent_claim_proof_refused')
    claims = proof['claims']
    contract.require(isinstance(claims, dict) and set(claims) == {
        'role', 'aud', 'iat', 'exp', 'replay_claimant_generation'}, 'signed_claim_shape_refused')
    contract.require(claims['role'] == 'pvb_staging_worker' and claims['aud'] == 'pvb-staging-receipts'
                     and claims['replay_claimant_generation'] == contract.GENERATION
                     and type(claims['exp']) is int and claims['exp'] == contract.EXPIRY
                     and type(claims['iat']) is int and claims['iat'] <= now.timestamp() + 60
                     and 0 < claims['exp'] - claims['iat'] <= 604800, 'signed_claim_scope_refused')


def _paid_database(database):
    contract.require(isinstance(database, dict) and set(database) == {
        'host', 'port', 'database', 'role', 'password', 'integrationId', 'businessId', 'ssl'},
        'paid_interest_shape_refused')
    expected = dict(host=contract.HOST, port=5432, database='postgres',
                    role='prefunded_treasury_operator', integrationId=contract.INTEGRATION,
                    businessId=contract.BUSINESS)
    contract.require(all(type(database.get(name)) is type(value) and database[name] == value
                         for name, value in expected.items()), 'paid_interest_scope_refused')
    contract.require(isinstance(database['password'], str) and 16 <= len(database['password']) <= 1024
                     and isinstance(database['ssl'], dict) and set(database['ssl']) == {'ca'}
                     and isinstance(database['ssl']['ca'], str)
                     and 1 <= len(database['ssl']['ca']) <= 65536, 'paid_interest_tls_refused')


def prepare_candidate(predecessor_files, interest_outer, artifact_files,
                      parent_receipt_token, parent_claim_proof, reviewed_claim_proof_sha256):
    now = contract.instant()
    contract.require(isinstance(predecessor_files, dict)
                     and set(predecessor_files) == set(contract.PREDECESSOR_FILES), 'predecessor_file_set_refused')
    for name, expected in contract.PREDECESSOR_FILES.items():
        content = predecessor_files[name]
        contract.require(type(content) is bytes and 0 < len(content) <= 16 * 1024 * 1024
                         and contract.sha(content) == expected, 'predecessor_file_pin_refused')
    contract.require(type(interest_outer) is bytes
                     and contract.sha(interest_outer) == contract.INTEREST_CONFIG_SHA256,
                     'interest_source_pin_refused')
    artifact_pins = artifact.validate_artifact(artifact_files)
    daemon = artifact_files['replay-daemon.mjs']
    contract.require(contract.sha(daemon) != contract.PREDECESSOR_FILES['code/replay-daemon.mjs'],
                     'reviewed_complete_daemon_required')
    _claim_proof(parent_receipt_token, parent_claim_proof, reviewed_claim_proof_sha256, now)
    base = contract.private_json(predecessor_files['config/config.json'])
    interest = contract.private_json(interest_outer)
    private = contract.private_json(predecessor_files['config/prefunded.json'])
    contract.require(isinstance(base, dict) and set(base) == contract.BASE_FIELDS | {'prefundedReplay'}
                     and base['environment'] == 'staging' and base['appSystemId'] == contract.APP_SYSTEM
                     and base['receiptSystemId'] == contract.RECEIPT_SYSTEM, 'native_outer_scope_refused')
    contract.require(isinstance(interest, dict) and set(interest) == contract.BASE_FIELDS | {'financialDatabase'}
                     and all(interest.get(name) == base[name] for name in (
                         'environment', 'appSystemId', 'receiptSystemId')), 'interest_outer_scope_refused')
    contract.require(isinstance(private, dict) and private.get('scope') == contract.FACTORY_SCOPE,
                     'unchanged_factory_scope_refused')
    contract.require(base['prefundedReplay'] == {
        'bundleSha256': contract.PREDECESSOR_FILES['code/prefunded-replay-bundle.mjs'],
        'configurationSha256': contract.PREDECESSOR_FILES['config/prefunded.json']},
        'unchanged_factory_activation_refused')
    contract.require(parent_receipt_token != base['receiptToken'], 'new_parent_generation_token_required')
    paid = interest['financialDatabase']
    _paid_database(paid)
    outer = {**base, 'receiptToken': parent_receipt_token, 'paidInterestDatabase': paid}
    files = {**predecessor_files, 'code/replay-daemon.mjs': daemon,
             'config/config.json': contract.serialize(outer)}
    seal = dict(schemaVersion=1, status='source-candidate-inactive', expiresAt=contract.DEADLINE,
                claimantGeneration=contract.GENERATION, appSystemId=contract.APP_SYSTEM,
                receiptSystemId=contract.RECEIPT_SYSTEM, factoryScope=dict(contract.FACTORY_SCOPE),
                predecessorContainerId=contract.NATIVE_ID, competitorContainerId=contract.COMPETITOR_ID,
                predecessorSealSha256=contract.PREDECESSOR_SEAL,
                predecessorFiles=dict(contract.PREDECESSOR_FILES),
                files={name: contract.sha(content) for name, content in files.items()},
                daemonArtifact=artifact_pins,
                receiptTokenSha256=parent_claim_proof['tokenSha256'],
                parentClaimProofSha256=reviewed_claim_proof_sha256,
                fenceManifestSha256=contract.FENCE_MANIFEST_SHA256,
                fencedBodySha256=contract.FENCED_BODY_SHA256,
                automaticPredecessorRestartAllowed=False, unfencedSqlRollbackAllowed=False,
                receiptCreditProved=False, runtimeStarted=False)
    contract.instant()
    return {'files': files, 'seal': seal, 'sealSha256': contract.digest(seal)}
