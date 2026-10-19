-- Optional customer continuity: ordinary cart grants never carry address/account scopes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='commerce_cart_account_linker') THEN
  CREATE ROLE commerce_cart_account_linker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO commerce_cart_account_linker;
GRANT commerce_cart_account_linker TO authenticator;
ALTER TABLE public.commerce_cart_grants ADD COLUMN linked_customer_id uuid NULL REFERENCES public.customers(id);
CREATE INDEX commerce_cart_grants_linked_customer_idx ON public.commerce_cart_grants(linked_customer_id);
CREATE TABLE public.commerce_cart_customer_carts (
 merchant_id uuid NOT NULL,customer_id uuid NOT NULL REFERENCES public.customers(id),cart_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(merchant_id,customer_id),
 FOREIGN KEY(merchant_id,cart_id) REFERENCES public.commerce_carts(merchant_id,id) ON DELETE CASCADE
);
CREATE INDEX commerce_cart_customer_carts_customer_idx ON public.commerce_cart_customer_carts(customer_id);
CREATE INDEX commerce_cart_customer_carts_cart_idx ON public.commerce_cart_customer_carts(merchant_id,cart_id);
CREATE TABLE public.commerce_cart_account_operations (
 merchant_id uuid NOT NULL,customer_id uuid NOT NULL REFERENCES public.customers(id),principal_id text NOT NULL,
 operation_id text NOT NULL,request_digest text NOT NULL,choice text NOT NULL CHECK(choice IN ('keep_current','use_saved','merge')),
 device_principal_id text NOT NULL,original_grant_id uuid NULL REFERENCES public.commerce_cart_grants(id),selected_principal_id text NOT NULL,
 original_cart_id uuid NULL,selected_cart_id uuid NOT NULL,source_cart_id uuid NULL,
 selected_grant_id uuid NOT NULL REFERENCES public.commerce_cart_grants(id),
 source_grant_id uuid NULL REFERENCES public.commerce_cart_grants(id),result jsonb NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 PRIMARY KEY(merchant_id,customer_id,principal_id,operation_id),
 FOREIGN KEY(merchant_id,original_cart_id) REFERENCES public.commerce_carts(merchant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(merchant_id,selected_cart_id) REFERENCES public.commerce_carts(merchant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(merchant_id,source_cart_id) REFERENCES public.commerce_carts(merchant_id,id) ON DELETE CASCADE
);
CREATE INDEX commerce_cart_account_operations_customer_idx ON public.commerce_cart_account_operations(customer_id);
CREATE INDEX commerce_cart_account_operations_original_idx ON public.commerce_cart_account_operations(merchant_id,original_cart_id);
CREATE INDEX commerce_cart_account_operations_selected_idx ON public.commerce_cart_account_operations(merchant_id,selected_cart_id);
CREATE INDEX commerce_cart_account_operations_source_idx ON public.commerce_cart_account_operations(merchant_id,source_cart_id);
CREATE INDEX commerce_cart_account_operations_grant_idx ON public.commerce_cart_account_operations(selected_grant_id);
CREATE INDEX commerce_cart_account_operations_source_grant_idx ON public.commerce_cart_account_operations(source_grant_id);
ALTER TABLE public.commerce_cart_customer_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_account_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_cart_customer_carts_owner_read ON public.commerce_cart_customer_carts FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.customers c WHERE c.id=commerce_cart_customer_carts.customer_id AND c.merchant_id=commerce_cart_customer_carts.merchant_id AND c.user_id=auth.uid())
);
CREATE POLICY commerce_cart_account_operations_owner_read ON public.commerce_cart_account_operations FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.customers c WHERE c.id=commerce_cart_account_operations.customer_id AND c.merchant_id=commerce_cart_account_operations.merchant_id AND c.user_id=auth.uid())
);
REVOKE ALL ON public.commerce_cart_customer_carts,public.commerce_cart_account_operations FROM PUBLIC,anon,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker,commerce_cart_account_linker;
GRANT SELECT ON public.commerce_cart_customer_carts,public.commerce_cart_account_operations TO authenticated;

CREATE INDEX commerce_cart_account_operations_original_grant_idx ON public.commerce_cart_account_operations(original_grant_id);
