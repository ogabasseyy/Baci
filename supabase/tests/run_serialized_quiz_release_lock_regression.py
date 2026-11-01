#!/usr/bin/env python3
"""Reproduce the quiz release versus merchant product/unit lock race."""
import os
import pathlib
import subprocess
import tempfile
import time

root = pathlib.Path(__file__).resolve().parents[2]
source = (root / 'supabase/migrations/20260804110000_quiz_final_results_and_product_winner.sql').read_text()
start = source.index('CREATE OR REPLACE FUNCTION private.release_quiz_prize_reservation_v2(')
end = source.index('\n$$;', start) + len('\n$$;')
function = source[start:end]
if os.environ.get('TEST_LINE_ENDINGS') == 'crlf':
    function = function.replace('\n', '\r\n')
pg_bin = pathlib.Path(os.environ.get('PG_BIN') or subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
fixture = '''
CREATE SCHEMA private;
CREATE TABLE products(id uuid PRIMARY KEY, merchant_id uuid, stock_quantity integer);
CREATE TABLE product_variants(id uuid PRIMARY KEY, product_id uuid, stock_quantity integer);
CREATE TABLE quiz_events(id uuid PRIMARY KEY);
CREATE TABLE quiz_awards(id uuid PRIMARY KEY, reserved_order_id uuid);
CREATE TABLE orders(id uuid PRIMARY KEY, merchant_id uuid, shipping_status text);
CREATE TABLE quiz_prize_reservations(id uuid PRIMARY KEY, event_id uuid, merchant_id uuid, product_id uuid, variant_id uuid, inventory_unit_id uuid, inventory_kind text, state text, award_id uuid, released_at timestamptz, release_reason text, updated_at timestamptz);
CREATE TABLE variant_inventory(id uuid PRIMARY KEY, variant_id uuid, status text, order_id uuid, order_item_id uuid, sold_at timestamptz, reserved_at timestamptz, reservation_expires_at timestamptz, updated_at timestamptz);
CREATE FUNCTION private.stock_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE public.products SET stock_quantity=stock_quantity WHERE id=(SELECT product_id FROM public.product_variants WHERE id=NEW.variant_id); RETURN NEW;
END $$;
CREATE TRIGGER stock_after_update AFTER UPDATE OF status ON variant_inventory FOR EACH ROW EXECUTE FUNCTION private.stock_trigger();
INSERT INTO products VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',1);
INSERT INTO product_variants VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020',1);
INSERT INTO quiz_events VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO quiz_prize_reservations VALUES ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',NULL,'00000000-0000-0000-0000-000000000050','serialized','reserved',NULL,NULL,NULL,now());
INSERT INTO variant_inventory VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000030','reserved',NULL,NULL,NULL,now(),NULL,now());
'''
with tempfile.TemporaryDirectory(prefix='baci-quiz-release-') as temp:
    path = pathlib.Path(temp); sock = path/'socket'; sock.mkdir(); data = path/'data'
    subprocess.run([str(pg_bin/'initdb'),'-D',str(data),'-U','postgres','--auth=trust','--no-locale'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-l',str(path/'server.log'),'-o',f"-h '' -k {sock} -p 55480",'-w','start'], check=True, stdout=subprocess.DEVNULL)
    try:
        psql = [str(pg_bin/'psql'),'-X','-h',str(sock),'-p','55480','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q']
        subprocess.run(psql, input=fixture+'\n'+function, text=True, check=True)
        patch = os.environ.get('BACI_QUIZ_RELEASE_PATCH', str(root/'supabase/migrations/20261101220556_serialized_quiz_release_product_lock.sql'))
        if patch: subprocess.run(psql+['-f',patch], check=True)
        env = dict(os.environ, PGAPPNAME='baci_quiz_release_lock_regression')
        editor = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        editor.stdin.write('BEGIN; SELECT id FROM products FOR UPDATE; SELECT pg_sleep(1); UPDATE variant_inventory SET updated_at=now(); COMMIT;\n'); editor.stdin.close()
        try:
            for _ in range(50):
                probe = subprocess.check_output(psql+['-Atc', "SELECT count(*) FROM pg_stat_activity WHERE application_name='baci_quiz_release_lock_regression' AND wait_event='PgSleep'"], text=True).strip()
                if probe == '1': break
                time.sleep(0.05)
            else: raise RuntimeError('editor did not acquire product lock')
            assertion = """SET lock_timeout='4s'; DO $$ BEGIN
              IF NOT private.release_quiz_prize_reservation_v2('00000000-0000-0000-0000-000000000001','no_eligible_winner') THEN RAISE EXCEPTION 'release failed'; END IF;
              IF NOT EXISTS (SELECT 1 FROM variant_inventory WHERE status='available') THEN RAISE EXCEPTION 'unit not released'; END IF;
              IF NOT EXISTS (SELECT 1 FROM quiz_prize_reservations WHERE state='released') THEN RAISE EXCEPTION 'reservation not released'; END IF;
            END $$;"""
            subprocess.run(psql, input=assertion, text=True, check=True, timeout=8)
            if editor.wait(timeout=8): raise RuntimeError(editor.stderr.read())
        finally:
            if editor.poll() is None: editor.kill(); editor.wait()
        print('Quiz release and concurrent merchant edit passed')
    finally:
        subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'], check=True, stdout=subprocess.DEVNULL)
