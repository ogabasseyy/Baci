import { createHmac, randomBytes } from 'node:crypto';

export async function provisionSyntheticAuth({
  secret,
  issuer,
  request,
  retain,
  now,
}) {
  if (
    typeof secret !== 'string' ||
    !/^[a-f0-9]{64}$/.test(secret) ||
    issuer !== 'https://staging-auth.ogabassey.com/auth/v1' ||
    !Number.isSafeInteger(now) ||
    now < 1
  )
    throw new Error('Invalid isolated Auth configuration');
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', aud: 'authenticated', iss: issuer, iat: now, exp: now + 60 })}`;
  const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  const users = [];
  for (const email of [
    'owner@savings.example.invalid',
    'customer@savings.example.invalid',
  ]) {
    let response;
    try {
      response = await request('/admin/users', {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password: randomBytes(32).toString('base64url'),
          email_confirm: true,
        }),
      });
    } catch {
      throw new Error(
        'Synthetic Auth result indeterminate; reconcile before retry'
      );
    }
    if (!response.ok)
      throw new Error(
        `Synthetic Auth provisioning rejected (${response.status})`
      );
    let user;
    try {
      user = await response.json();
    } catch {
      throw new Error(
        'Synthetic Auth response invalid; reconcile before retry'
      );
    }
    if (
      user.email !== email ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        user.id ?? ''
      )
    )
      throw new Error(
        'Synthetic Auth identity mismatch; reconcile before retry'
      );
    const identity = { id: user.id, email };
    await retain(identity);
    users.push(identity);
  }
  return users;
}
