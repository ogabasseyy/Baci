import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt-in and socket-only: never connect this destructive fixture to a hosted DB.
const database = process.env.OXYGEN_FINANCIAL_FENCE_TEST_DB;
const enabled = Boolean(
  database && /^oxygen_financial_fence_test[0-9_]*$/.test(database)
);
const port = Number(process.env.OXYGEN_FINANCIAL_FENCE_TEST_PORT ?? '25488');
const socket = process.env.OXYGEN_FINANCIAL_FENCE_TEST_SOCKET ?? '';
if (
  database &&
  (!enabled || !/^\/tmp\/oxygen-financial-fence-[a-zA-Z0-9]+$/.test(socket))
) {
  throw new Error(
    'Financial fence tests require an isolated fixture database and socket'
  );
}
const ids = Array.from({ length: 8 }, () => randomUUID());
const [
  actor,
  merchant,
  customer,
  order,
  existingOrder,
  itemA,
  itemB,
  existingWorkflow,
] = ids;
const config = {
  host: socket,
  port,
  database: database ?? '',
  user: process.env.USER,
};
let first: Client;
let second: Client;
let setup: Client;

describe.skipIf(!enabled)('Oxygen financial edit admission', () => {
  beforeAll(async () => {
    first = new Client(config);
    second = new Client(config);
    setup = new Client(config);
    await Promise.all([first.connect(), second.connect(), setup.connect()]);
    for (const client of [first, second, setup])
      await client.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false)",
        [actor]
      );
    await setup.query(
      "INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'test',now(),now(),now(),'{}','{}')",
      [actor, `${actor}@example.test`]
    );
    await setup.query(
      'INSERT INTO public.merchants(id,user_id,email,business_name,slug) VALUES ($1,$2,$3,$4,$5)',
      [
        merchant,
        actor,
        `${actor}@example.test`,
        'Fence fixture',
        `fence-${actor}`,
      ]
    );
    await setup.query(
      'INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email) VALUES ($1,$2,$3,$4,$5,$6)',
      [customer, merchant, actor, 'Fence', 'Customer', `${actor}@example.test`]
    );
    for (const id of [order, existingOrder])
      await setup.query(
        "INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount) VALUES ($1,$2,$3,$4,100,100,'NGN','unpaid','paystack',0,0)",
        [id, merchant, customer, `FENCE-${id}`]
      );
    await setup.query(
      "INSERT INTO public.order_items(id,order_id,name,price,quantity) VALUES ($1,$3,'First',50,1),($2,$3,'Second',50,1)",
      [itemA, itemB, order]
    );
    await setup.query(
      "INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,stage) VALUES ($1,$2,$3,$4,'plan_required')",
      [existingWorkflow, existingOrder, merchant, customer]
    );
  });
  afterAll(async () => {
    await Promise.all([first.query('ROLLBACK'), second.query('ROLLBACK')]);
    await setup.query(
      'DELETE FROM public.oxygen_workflows WHERE merchant_id=$1',
      [merchant]
    );
    await setup.query(
      'DELETE FROM public.order_items WHERE order_id IN ($1,$2)',
      [order, existingOrder]
    );
    await setup.query('DELETE FROM public.orders WHERE merchant_id=$1', [
      merchant,
    ]);
    await setup.query('DELETE FROM public.customers WHERE id=$1', [customer]);
    await setup.query('DELETE FROM public.merchants WHERE id=$1', [merchant]);
    await setup.query('DELETE FROM auth.users WHERE id=$1', [actor]);
    await Promise.all([first.end(), second.end(), setup.end()]);
  });
  it('rejects a first workflow or Oxygen switch while a pre-workflow item edit is open', async () => {
    await first.query('BEGIN');
    await first.query('UPDATE public.order_items SET quantity=2 WHERE id=$1', [
      itemA,
    ]);
    await expect(
      second.query(
        "INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,stage) VALUES ($1,$2,$3,$4,'plan_required')",
        [randomUUID(), order, merchant, customer]
      )
    ).rejects.toMatchObject({
      code: '40001',
      message: 'oxygen_order_edit_retry',
    });
    await expect(
      second.query(
        "UPDATE public.orders SET payment_method='oxygen' WHERE id=$1",
        [order]
      )
    ).rejects.toMatchObject({
      code: '40001',
      message: 'oxygen_order_edit_retry',
    });
    await first.query('ROLLBACK');
  });
  it('rejects a competing item edit while first-workflow admission is open', async () => {
    await first.query('BEGIN');
    await first.query(
      "INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,stage) VALUES ($1,$2,$3,$4,'plan_required')",
      [randomUUID(), order, merchant, customer]
    );
    await expect(
      second.query('UPDATE public.order_items SET quantity=2 WHERE id=$1', [
        itemA,
      ])
    ).rejects.toMatchObject({
      code: '40001',
      message: 'oxygen_order_edit_retry',
    });
    await first.query('ROLLBACK');
  });
  it('blocks total, customer and item edits once an application is established', async () => {
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id=$1",
      [existingWorkflow]
    );
    await setup.query(
      'INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ($1,$2)',
      [existingWorkflow, { applicationReference: 'fixture' }]
    );
    for (const [query, args] of [
      ['UPDATE public.orders SET total=101 WHERE id=$1', [existingOrder]],
      [
        'UPDATE public.orders SET customer_id=$2 WHERE id=$1',
        [existingOrder, randomUUID()],
      ],
    ] as const) {
      await expect(second.query(query, [...args])).rejects.toMatchObject({
        code: '23514',
        message: 'oxygen_financial_edit_locked',
      });
    }
    await expect(
      second.query(
        "INSERT INTO public.order_items(order_id,name,price,quantity) VALUES($1,'extra',1,1)",
        [existingOrder]
      )
    ).rejects.toMatchObject({
      code: '23514',
      message: 'oxygen_financial_edit_locked',
    });
    await setup.query(
      'DELETE FROM oxygen_private.provider_states WHERE workflow_id=$1',
      [existingWorkflow]
    );
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id=$1",
      [existingWorkflow]
    );
  });
  it('blocks an uncertain or successful start and an application reference before stage transition', async () => {
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='application_required' WHERE id=$1",
      [existingWorkflow]
    );
    for (const status of ['indeterminate', 'succeeded']) {
      await setup.query(
        'INSERT INTO oxygen_private.commands(workflow_id,command,status) VALUES ($1,$2,$3)',
        [existingWorkflow, { action: 'start_application' }, status]
      );
      await expect(
        second.query('UPDATE public.orders SET total=101 WHERE id=$1', [
          existingOrder,
        ])
      ).rejects.toMatchObject({
        code: '23514',
        message: 'oxygen_financial_edit_locked',
      });
      await setup.query(
        'DELETE FROM oxygen_private.commands WHERE workflow_id=$1',
        [existingWorkflow]
      );
    }
    await setup.query(
      'INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ($1,$2)',
      [existingWorkflow, { applicationReference: 'fixture' }]
    );
    await expect(
      second.query('UPDATE public.orders SET total=101 WHERE id=$1', [
        existingOrder,
      ])
    ).rejects.toMatchObject({
      code: '23514',
      message: 'oxygen_financial_edit_locked',
    });
    await setup.query(
      'DELETE FROM oxygen_private.provider_states WHERE workflow_id=$1',
      [existingWorkflow]
    );
    await setup.query('UPDATE public.orders SET total=101 WHERE id=$1', [
      existingOrder,
    ]);
    await setup.query('UPDATE public.orders SET total=100 WHERE id=$1', [
      existingOrder,
    ]);
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id=$1",
      [existingWorkflow]
    );
  });
  it('permits a payment-method-only exit before booking while fencing combined edits', async () => {
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='application_required' WHERE id=$1",
      [existingWorkflow]
    );
    await setup.query(
      "UPDATE public.orders SET payment_method='oxygen' WHERE id=$1",
      [existingOrder]
    );
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id=$1",
      [existingWorkflow]
    );
    await setup.query(
      'INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ($1,$2)',
      [existingWorkflow, { applicationReference: 'fixture' }]
    );
    await expect(
      second.query(
        "UPDATE public.orders SET payment_method='paystack',total=101 WHERE id=$1",
        [existingOrder]
      )
    ).rejects.toMatchObject({
      code: '23514',
      message: 'oxygen_financial_edit_locked',
    });
    await second.query(
      "UPDATE public.orders SET payment_method='paystack' WHERE id=$1",
      [existingOrder]
    );
    await setup.query(
      'DELETE FROM oxygen_private.provider_states WHERE workflow_id=$1',
      [existingWorkflow]
    );
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='application_required' WHERE id=$1",
      [existingWorkflow]
    );
    await setup.query(
      "UPDATE public.orders SET payment_method='oxygen' WHERE id=$1",
      [existingOrder]
    );
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id=$1",
      [existingWorkflow]
    );
    await setup.query(
      "INSERT INTO oxygen_private.commands(workflow_id,command,status) VALUES ($1,$2,'indeterminate')",
      [existingWorkflow, { action: 'book' }]
    );
    await expect(
      second.query(
        "UPDATE public.orders SET payment_method='paystack' WHERE id=$1",
        [existingOrder]
      )
    ).rejects.toMatchObject({
      code: 'P0001',
      message: 'oxygen_payment_in_progress',
    });
    await setup.query(
      'DELETE FROM oxygen_private.commands WHERE workflow_id=$1',
      [existingWorkflow]
    );
    await setup.query(
      'INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ($1,$2)',
      [existingWorkflow, { bookingReference: 'fixture' }]
    );
    await expect(
      second.query(
        "UPDATE public.orders SET payment_method='paystack' WHERE id=$1",
        [existingOrder]
      )
    ).rejects.toMatchObject({
      code: 'P0001',
      message: 'oxygen_payment_in_progress',
    });
    await setup.query(
      'DELETE FROM oxygen_private.provider_states WHERE workflow_id=$1',
      [existingWorkflow]
    );
    await first.query('BEGIN');
    await first.query(
      'SELECT id FROM public.oxygen_workflows WHERE id=$1 FOR UPDATE',
      [existingWorkflow]
    );
    await expect(
      second.query(
        "UPDATE public.orders SET payment_method='paystack' WHERE id=$1",
        [existingOrder]
      )
    ).rejects.toMatchObject({
      code: '40001',
      message: 'oxygen_order_edit_retry',
    });
    await first.query('ROLLBACK');
    await second.query(
      "UPDATE public.orders SET payment_method='paystack' WHERE id=$1",
      [existingOrder]
    );
    await setup.query(
      "UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id=$1",
      [existingWorkflow]
    );
  });
  it('does not wait with an order lock when the workflow is already locked', async () => {
    await first.query('BEGIN');
    await first.query(
      'SELECT id FROM public.oxygen_workflows WHERE id=$1 FOR UPDATE',
      [existingWorkflow]
    );
    await expect(
      second.query('UPDATE public.orders SET shipping_fee=1 WHERE id=$1', [
        existingOrder,
      ])
    ).rejects.toMatchObject({
      code: '40001',
      message: 'oxygen_order_edit_retry',
    });
    await first.query('ROLLBACK');
  });
  it('allows independent item edits for an order without Oxygen admission', async () => {
    await first.query('BEGIN');
    await first.query('UPDATE public.order_items SET quantity=2 WHERE id=$1', [
      itemA,
    ]);
    await second.query('BEGIN');
    await second.query('UPDATE public.order_items SET quantity=2 WHERE id=$1', [
      itemB,
    ]);
    await Promise.all([first.query('ROLLBACK'), second.query('ROLLBACK')]);
  });
});
