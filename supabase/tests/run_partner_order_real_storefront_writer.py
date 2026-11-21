#!/usr/bin/env python3
"""Run partner acceptance through the real storefront writer on a reduced schema."""

from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
SQL_TESTS = MIGRATIONS / 'tests'
WRITER_PREFIX = 'CREATE OR REPLACE FUNCTION private.create_storefront_order'


def migration(version):
    path, = MIGRATIONS.glob(f'{version}_*.sql')
    return path.read_text()


def definition(source, signature, delimiter='$$'):
    start = source.index(signature)
    end = source.index(f'{delimiter};', start) + len(delimiter) + 1
    return source[start:end]


def reduced_schema_sql():
    partner_fixture = (SQL_TESTS / 'accept_settled_partner_order_fixture.sql').read_text()
    writer_source = migration('20261020090000')
    return [
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA discovery;',
        (ROOT / 'supabase/tests/commerce_cart_condition_order.sql').read_text(),
        """
        ALTER TABLE public.merchants ADD COLUMN email text, ADD COLUMN business_name text, ADD COLUMN slug text;
        ALTER TABLE public.products ADD COLUMN has_condition_offers boolean, ADD COLUMN has_variants boolean,
          ADD COLUMN stock integer;
        ALTER TABLE public.product_offers ADD COLUMN grade text, ADD COLUMN condition_notes text;
        ALTER TABLE public.orders ADD COLUMN shipping_funding_source text,
          ADD COLUMN shipping_platform_retained_amount numeric, ADD COLUMN amount_paid numeric DEFAULT 0;
        ALTER TABLE public.order_items ADD COLUMN product_offer_id uuid, ADD COLUMN offer_id uuid,
          ADD COLUMN offer_line boolean, ADD COLUMN offer_grade text, ADD COLUMN offer_condition_notes text,
          ADD COLUMN offer_labels_snapshotted boolean;
        """,
        partner_fixture[
            partner_fixture.index('CREATE TABLE public.transactions'):
            partner_fixture.index('CREATE FUNCTION private.create_storefront_order')
        ],
        partner_fixture[partner_fixture.index('CREATE TABLE public.shipping_quotes'):],
        """
        CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
          SELECT nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
        $$;
        CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
          SELECT auth.jwt()->>'role';
        $$;
        CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql STABLE
          AS $$ SELECT false; $$;
        """,
        migration('20260828101000'),
        """
        CREATE TRIGGER enforce_storefront_order_route_context
        BEFORE INSERT ON public.orders FOR EACH ROW
        EXECUTE FUNCTION private.enforce_storefront_order_route_context();
        """,
        migration('20261001170000'),
        definition(migration('20261015130400'), 'CREATE OR REPLACE FUNCTION public.commerce_cart_resolve_merchant_currency('),
        definition(migration('20261015090000'), 'CREATE OR REPLACE FUNCTION public.commerce_cart_product_negotiable('),
        definition(migration('20261015130500'), 'CREATE OR REPLACE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed('),
        definition(writer_source, f'{WRITER_PREFIX}(', '$function$'),
        definition(writer_source, f'{WRITER_PREFIX}_unchecked(', '$function$'),
        migration('20261101220846'),
        migration('20261024160001').split('-- Normal caller clients only.')[0],
    ]


def partner_schema_sql():
    versions = [
        '20261120143000', '20261120144500', '20261120150000', '20261120151500',
        '20261120153000', '20261120154500', '20261120160000',
        '20261120165200', '20261120165500', '20261120165600',
        '20261120170700', '20261120170800',
        '20261120171200', '20261120171900',
        '20261120185600',
        '20261120190800',
        '20261120191400',
        '20261120192100',
        '20261120192400',
        '20261120194800', '20261121100000', '20261121110000', '20261121113000',
    ]
    return [*reduced_schema_sql(), *(migration(version) for version in versions)]


def run():
    sql = '\n'.join([
        *partner_schema_sql(),
        (SQL_TESTS / 'partner_order_real_storefront_writer.sql').read_text(),
    ])
    with tempfile.TemporaryDirectory(prefix='baci-partner-writer-') as directory:
        prefix = Path(directory)
        data = prefix / 'data'
        subprocess.run(
            ['initdb', '-D', str(data), '-U', 'postgres', '--auth=trust', '--no-locale'],
            stdout=subprocess.DEVNULL, check=True,
        )
        subprocess.run(
            ['pg_ctl', '-D', str(data), '-l', str(prefix / 'postgres.log'), '-o', f"-h '' -k {prefix} -p 55469", '-w', 'start'],
            stdout=subprocess.DEVNULL, check=True,
        )
        try:
            subprocess.run(
                ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', '55469', '-U', 'postgres', '-d', 'postgres'],
                input=sql, text=True, check=True,
            )
        finally:
            subprocess.run(
                ['pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop'],
                stdout=subprocess.DEVNULL, check=True,
            )
    print('Partner acceptance passed with the real storefront order writer on a reduced schema.')


if __name__ == '__main__':
    run()
