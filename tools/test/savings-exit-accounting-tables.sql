ALTER TABLE public.orders ADD PRIMARY KEY (id);
ALTER TABLE public.order_items ADD PRIMARY KEY (id);
ALTER TABLE public.transactions ADD PRIMARY KEY (id);
ALTER TABLE public.orders ADD FOREIGN KEY (merchant_id) REFERENCES public.merchants(id);
ALTER TABLE public.orders ADD FOREIGN KEY (customer_id) REFERENCES public.customers(id);
ALTER TABLE public.order_items ADD FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE public.transactions ADD FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE public.transactions ADD FOREIGN KEY (merchant_id) REFERENCES public.merchants(id);
