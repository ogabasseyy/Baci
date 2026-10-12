import json
from urllib.error import HTTPError

from phone_authentication import API, authenticate, request_json


GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'


def summarize(response):
    if (not isinstance(response, dict)
            or set(response) != {'goalId', 'enabled', 'maximumAmountKobo', 'currency'}
            or response.get('goalId') != GOAL or response.get('currency') != 'NGN'
            or type(response.get('enabled')) is not bool
            or type(response.get('maximumAmountKobo')) is not int
            or not 0 <= response['maximumAmountKobo'] <= 10000
            or response['enabled'] and response['maximumAmountKobo'] == 0):
        raise ValueError('checkout-capability-refused')
    return dict(firstCardEnabled=response['enabled'], maximumAmountKobo=response['maximumAmountKobo'],
                authenticatedCustomerVerified=True, newPaymentStarted=False, financialChangesMade=False)


def run():
    status, response = request_json(API + '/api/storefront/customer/savings/card-checkout?goalId=' + GOAL,
                                   authenticate())
    if status != 200:
        raise ValueError('checkout-http-refused')
    print(json.dumps(dict(status='authenticated-checkout-read', http=status, **summarize(response))))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps(dict(status='checkout-read-refused', redacted=True,
            http=error.code if isinstance(error, HTTPError) else None,
            errorType=type(error).__name__, newPaymentStarted=False, financialChangesMade=False)))
        raise SystemExit(1)
