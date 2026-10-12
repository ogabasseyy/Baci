AMOUNT_KOBO = 10000


def dispatch(api, wallet_id, journal, save):
    if journal.get('phase') != 'prepared' or journal.get('walletId') != wallet_id:
        raise RuntimeError('Funding already attempted or identity changed; reconcile without retry')
    wallet = api('GET', '/api/v1/wallet/' + wallet_id)['data']
    if wallet.get('id') != wallet_id or wallet.get('currency') != 'NGN' or wallet.get('balance') != 0:
        raise RuntimeError('Expected empty sandbox wallet')
    save({**journal, 'phase': 'dispatched', 'amountKobo': AMOUNT_KOBO})
    response = api('POST', '/api/v1/transfer/test/funding', {
        'wallet_id': wallet_id, 'amount': AMOUNT_KOBO,
    })
    if response.get('status') is not True:
        raise RuntimeError('Funding outcome unknown; reconcile without retry')
    save({**journal, 'phase': 'accepted', 'amountKobo': AMOUNT_KOBO})
    return {'status': 'accepted-not-settled', 'amountKobo': AMOUNT_KOBO}
