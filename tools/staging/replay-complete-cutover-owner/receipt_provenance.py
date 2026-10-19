from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from cutover_runtime import require


RECEIPT = '0f9938ae-8551-4e2e-8816-853e0231b2c3'
PAYLOAD = '269d3c467e0c3fccb776beed56871ab1180f93ec1313a314ba62af611c0ecc7e'
EVENT = '01M3YP771123DWC9Y8Y4814Z8Y'
CUSTOMER = 'c096507d-dc32-45d2-9c01-871a27abfd10'
SOURCE = '01M238A0V75387H4HZ15YFWGX3'
DESTINATION = '01M3W0Y93XHJY9RPQ2G75X81WG'
SOURCE_FAAS = '01M238A757Y931HHB238T7MCFM'
DESTINATION_FAAS = '01M3W0YENHMFJ8Z9FS76E3CC6T'
REFERENCE = 'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65'
TRANSACTION = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'
NATIVE_REFERENCE = '01M3YP6VMSZX61CMB5V4Z07RAJ'
ORIGINAL_PROOF = 'd7c41bf04af9b1482c850d240ca190d9edd7484cbc04c868ab1626cea5583f14'
INTAKE = '/home/bassey/pvb-staging-receipts/intake-config.json'
INTAKE_SHA = '4ea1ad60121b0ac44470f1c62504d28222b167612865230cfb675797573f944b'
AUDIT = Path('/root/baci-financial-owner.2ynkl9kc/signed-transfer-readonly-29ee22b014c04aeb98a229bc51b674b8.json')


def _instant():
    now = datetime.now(timezone.utc)
    require(now < datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc), 'fixed_deadline_expired')
    return now


def _fresh(value):
    require(type(value) is str and value.endswith('Z'), 'receipt_storage_refused')
    observed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(0 <= (_instant() - observed).total_seconds() <= 60, 'receipt_storage_refused')


def checked_storage(report):
    try:
        expected = dict(receiptId=RECEIPT, payloadSha256=PAYLOAD, signatureReceiptId=RECEIPT,
            signaturePayloadSha256=PAYLOAD, receiptCount=1, signatureCount=1,
            signaturePreserved=True, signedPayloadHashMatches=True,
            claimTokenPresent=False, leaseExpiresAt=None)
        require(type(report) is dict and set(report) == set(expected) | {
            'identity', 'observedAt', 'status', 'sealed', 'providerSignature'}, 'receipt_storage_refused')
        require(all(type(report[name]) is type(value) and report[name] == value
                    for name, value in expected.items()), 'receipt_storage_refused')
        identity = dict(systemIdentifier='7686901100561231906', sessionUser='supabase_admin',
            currentUser='supabase_admin', database='postgres', localUnix=True, readOnly=True)
        require(type(report['identity']) is dict and set(report['identity']) == set(identity)
                and all(type(report['identity'][name]) is type(value) and report['identity'][name] == value
                        for name, value in identity.items()), 'receipt_storage_refused')
        require(report['status'] in ('received', 'quarantined', 'processed', 'dead_letter'), 'receipt_storage_refused')
        require(type(report['sealed']) is dict and report['sealed']['payloadSha256'] == PAYLOAD
                and type(report['providerSignature']) is str, 'receipt_storage_refused')
        _fresh(report['observedAt'])
        return {name: value for name, value in report.items() if name not in ('sealed', 'providerSignature')}
    except Exception:
        raise ValueError('receipt_storage_refused') from None


def checked_native(event):
    expected = dict(eventId=EVENT, eventType='wallet-transfer.outflow.success',
        eventCategory='wallet_transfer', customer_id=CUSTOMER, pvb_wallet=SOURCE,
        pvb_destination_wallet=DESTINATION, pvb_third_party_reference=REFERENCE)
    inner = dict(customer_id=CUSTOMER, source_wallet=SOURCE_FAAS, destination_wallet=DESTINATION_FAAS,
        amount=10000, currency='NGN', status='COMPLETED', third_party_reference=TRANSACTION,
        initiator_reference=TRANSACTION, reference=NATIVE_REFERENCE, internal_reference=NATIVE_REFERENCE,
        transaction_id='2d3ee34a-74e9-4992-b0c2-f8a653e4ff02')
    require(type(event) is dict and all(type(event.get(name)) is type(value) and event[name] == value
            for name, value in expected.items()), 'original_native_identity_refused')
    detail = event.get('eventData')
    require(type(detail) is dict and all(type(detail.get(name)) is type(value) and detail[name] == value
            for name, value in inner.items()), 'original_native_identity_refused')


def collect_original_receipt(context, sql_path, sql_pin, crypto_path, crypto_pin):
    try:
        _instant()
        sql = context.owner.read(Path(sql_path), sql_pin).decode()
        context.owner.read(Path(crypto_path), crypto_pin)
        audit_bytes = context.owner.read(AUDIT, ORIGINAL_PROOF, limit=65536)
        require(hashlib.sha256(audit_bytes).hexdigest() == ORIGINAL_PROOF, 'original_audit_pin_refused')
        audit = context.owner.decode(audit_bytes)
        require(set(audit) == {'receiptId', 'payloadSha256', 'rawResponse', 'receivedAt',
            'originalSignatureVerified'} and audit['receiptId'] == RECEIPT
            and audit['payloadSha256'] == PAYLOAD and audit['originalSignatureVerified'] is True,
            'original_audit_identity_refused')
        require(type(audit['rawResponse']) is str and hashlib.sha256(audit['rawResponse'].encode()).hexdigest()
                == PAYLOAD, 'original_audit_bytes_refused')
        event = context.owner.decode(audit['rawResponse'].encode())
        checked_native(event)
        settings = context.owner.decode(context.owner.read(INTAKE, INTAKE_SHA, modes=(0o444,), uid=1001))
        require(set(settings) == {'environment', 'integrationToken', 'providerSecret', 'encryptionKey',
            'restToken'} and settings['environment'] == 'staging', 'intake_scope_refused')
        report = context.database(sql)
        storage = checked_storage(report)
        request = dict(sealed=report['sealed'], providerSignature=report['providerSignature'],
            originalRaw=audit['rawResponse'], encryptionKey=settings['encryptionKey'],
            providerSecret=settings['providerSecret'])
        cryptography = json.loads(context.finance['command'](['/usr/bin/node', str(crypto_path)],
            input_text=json.dumps(request, separators=(',', ':'))))
        require(cryptography == dict(status='original-receipt-cryptography-verified',
            payloadSha256=PAYLOAD, hmacSha512Verified=True, aeadVerified=True, plaintextMatchesAudit=True),
            'original_cryptography_refused')
        observed = _instant().isoformat(timespec='microseconds').replace('+00:00', 'Z')
        _fresh(storage['observedAt'])
        provenance = dict(origin='original_signed_native_receipt', receiptId=RECEIPT,
            payloadSha256=PAYLOAD, eventId=event['eventId'], nativeTransactionId=event['eventData']['third_party_reference'],
            nativeEventCategory=event['eventCategory'], sourceProofSha256=ORIGINAL_PROOF,
            sourceProofObservedAt=observed, hmacSha512Verified=cryptography['hmacSha512Verified'],
            aeadVerified=cryptography['aeadVerified'], newPaymentStarted=False)
        return dict(receiptStorage=storage, provenance=provenance)
    except Exception:
        raise ValueError('original_receipt_provenance_refused') from None
