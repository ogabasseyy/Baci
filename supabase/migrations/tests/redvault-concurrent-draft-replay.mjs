import { spawn } from 'node:child_process';

export async function checkConcurrentDraftRetry({ root, port, sql }) {
  sql(
    `UPDATE public.test_input SET order_input = jsonb_set(order_input,'{checkout_idempotency_key}','"concurrent-new-key"');`
  );
  const concurrentInput = `SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false); SET ROLE authenticated; SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input;`;
  await Promise.all(
    [1, 2].map(
      () =>
        new Promise((complete, fail) => {
          const process = spawn('/opt/homebrew/bin/psql', [
            '-X',
            '-v',
            'ON_ERROR_STOP=1',
            '-h',
            root,
            '-p',
            port,
            '-U',
            'postgres',
            '-d',
            'postgres',
          ]);
          let error = '';
          process.stdout.resume();
          process.stderr.on('data', (value) => {
            error += value;
          });
          process.on('error', fail);
          process.on('close', (code) =>
            code === 0 ? complete() : fail(new Error(error))
          );
          process.stdin.end(concurrentInput);
        })
    )
  );
  sql(
    `DO $$ BEGIN IF (SELECT count(*) FROM public.orders) <> 2 OR (SELECT count(*) FROM private.uba_redvault_applications) <> 2 THEN RAISE EXCEPTION 'concurrent draft duplication'; END IF; END $$;`
  );
}
