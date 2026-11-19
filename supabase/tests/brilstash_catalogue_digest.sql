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
  IF NOT private.brilstash_payload_has_wire_shape(vector->'payload')
    OR encode(sha256(convert_to(
      private.brilstash_canonical_json(vector->'payload'), 'UTF8'
    )), 'hex') IS DISTINCT FROM vector->>'digest'
  THEN RAISE EXCEPTION 'BrilStash canonical JSON v1 parity failed'; END IF;
END;
$test$;
