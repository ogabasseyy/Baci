import copy

PATH = '/api/storefront/customer/savings/funding'


def extend(baseline):
    if set(baseline) != {'version', 'routes'} or baseline['version'] != 3:
        raise RuntimeError('Unexpected Vercel routing configuration')
    candidate = copy.deepcopy(baseline)
    routes = candidate['routes']
    if not isinstance(routes, list) or not routes or routes[-1] != {'handle': 'filesystem'}:
        raise RuntimeError('Webhook filesystem fallthrough missing')
    matching = [(index, route) for index, route in enumerate(routes) if route.get('src') == '^' + PATH + '$']
    if len(matching) != 2:
        raise RuntimeError('Funding route contract changed')
    (index, forward), (fallback_index, fallback) = matching
    expected = {'src': '^' + PATH + '$', 'dest': 'https://staging-auth.ogabassey.com' + PATH, 'methods': ['POST']}
    if forward != expected or fallback != {'src': '^' + PATH + '$', 'status': 405} or fallback_index <= index:
        raise RuntimeError('Funding route baseline drift')
    routes[index] = {**forward, 'methods': ['GET', 'POST']}
    return candidate
