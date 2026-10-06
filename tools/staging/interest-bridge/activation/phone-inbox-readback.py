import json
import urllib.parse
from urllib.error import HTTPError

import phone_authentication



def summarize(response):
    if not isinstance(response, dict) or not isinstance(response.get('notifications'), list):
        raise ValueError('inbox-shape')
    notifications = response['notifications']
    if len(notifications) > 100 or any(not isinstance(row, dict) or 'readAt' not in row
            or row['readAt'] is not None and not isinstance(row['readAt'], str) for row in notifications):
        raise ValueError('inbox-count')
    return dict(notificationCount=len(notifications), unreadCount=sum(row['readAt'] is None for row in notifications),
                financialChangesMade=False, deviceReceiptVerified=False)


def run(helper=phone_authentication):
    headers = helper.authenticate()
    status, merchants = helper.request_json(helper.AUTH + '/rest/v1/merchants?select=id,slug&id=eq.' + helper.MERCHANT, headers)
    if (type(status) is not int or status != 200 or type(merchants) is not list
            or len(merchants) != 1 or type(merchants[0]) is not dict
            or merchants[0].get('id') != helper.MERCHANT
            or type(merchants[0].get('slug')) is not str or not 0 < len(merchants[0]['slug']) <= 255):
        raise ValueError('merchant-identity')
    status, response = helper.request_json(helper.API + '/api/storefront/customer/savings/notifications?' +
        urllib.parse.urlencode({'merchantId': helper.MERCHANT, 'merchantSlug': merchants[0]['slug']}), headers)
    if type(status) is not int or status != 200:
        raise ValueError('inbox-status')
    print(json.dumps(dict(status='authenticated-inbox-read', http=status, **summarize(response))))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps(dict(status='inbox-read-refused', errorType=type(error).__name__, redacted=True,
                              http=error.code if isinstance(error, HTTPError) else None,
                              financialChangesMade=False, deviceReceiptVerified=False)))
        raise SystemExit(1)
