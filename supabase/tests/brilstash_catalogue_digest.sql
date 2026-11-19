-- This vector is also read by catalogue-snapshot.test.ts.
DO $test$
DECLARE vector jsonb := $vector${
  "payload": [
    {
      "external_id": "digest-first",
      "product_url": "https://shop.example.invalid/products/caf%C3%A9%2Bphone",
      "title": "Café Phone “Plus” 😀",
      "description": "Quoted \"specification\", a backslash \\, and packaging details.",
      "category": "Téléphones",
      "price_naira": 350000.25,
      "stock_quantity": 0,
      "images": [
        {
          "url": "https://images.example.invalid/first.jpg"
        },
        {
          "url": "https://images.example.invalid/second.jpg"
        }
      ]
    },
    {
      "external_id": "digest-second",
      "product_url": "https://shop.example.invalid/products/accessory",
      "title": "Accessoire",
      "description": "Box contents: adapter.",
      "category": "Accessoires",
      "price_naira": 9007199254740991,
      "stock_quantity": 7,
      "images": [
        {
          "url": "https://images.example.invalid/adapter.jpg"
        }
      ],
      "brand": "Exemple"
    }
  ],
  "digest": "a550664cb802aca3ae27d0a78df7e30db69de76e6e5173c7939b661bccecf196"
}$vector$::jsonb;
BEGIN
  -- Match page-correlation.test.ts and the SQL saved-connection calculation.
  IF encode(sha256(convert_to(private.brilstash_canonical_json(jsonb_build_array(
      'brilstash-page-v1',
      'd0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000001',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )), 'UTF8')), 'hex') IS DISTINCT FROM 'd85814118e5308560e3ff9929dde5b3143ee678ee37eb804fdf549078e624256'
  THEN RAISE EXCEPTION 'BrilStash page correlation vector changed'; END IF;
  IF private.brilstash_payload_has_wire_shape(
    jsonb_set(vector->'payload', '{0,model_number}', '"unreviewed"')
  ) THEN RAISE EXCEPTION 'BrilStash wire shape accepted an unreviewed model number'; END IF;
  IF NOT private.brilstash_payload_has_wire_shape(vector->'payload')
    OR encode(sha256(convert_to(
      private.brilstash_canonical_json(vector->'payload'), 'UTF8'
    )), 'hex') IS DISTINCT FROM vector->>'digest'
  THEN RAISE EXCEPTION 'BrilStash canonical JSON v1 parity failed'; END IF;
END;
$test$;
