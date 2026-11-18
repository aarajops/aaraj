ALTER TABLE catalog.product
ADD COLUMN product_type text NOT NULL DEFAULT 'single';

ALTER TABLE catalog.product
ADD CONSTRAINT product_type_check CHECK (
    product_type IN ('single', 'combo')
);

CREATE TABLE catalog.combo (
    product_id uuid PRIMARY KEY REFERENCES catalog.product (id) ON DELETE CASCADE,
    selection_mode text NOT NULL,
    price_bdt integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT combo_selection_mode_check CHECK (
        selection_mode IN (
            'fixed_combo',
            'mix_colors_one_size',
            'mix_sizes_and_colors'
        )
    ),
    CONSTRAINT combo_price_check CHECK (
        price_bdt BETWEEN 0 AND 2147483647
    )
);

CREATE TABLE catalog.combo_component (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    combo_product_id uuid NOT NULL REFERENCES catalog.combo (product_id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES catalog.product (id) ON DELETE RESTRICT,
    fixed_color text,
    sort_order integer NOT NULL,
    CONSTRAINT combo_component_product_uidx UNIQUE (combo_product_id, product_id),
    CONSTRAINT combo_component_order_uidx UNIQUE (combo_product_id, sort_order),
    CONSTRAINT combo_component_not_self_check CHECK (
        product_id <> combo_product_id
    ),
    CONSTRAINT combo_component_order_check CHECK (sort_order >= 0),
    CONSTRAINT combo_component_fixed_color_check CHECK (
        fixed_color IS NULL
        OR (
            fixed_color = btrim (fixed_color)
            AND length(fixed_color) BETWEEN 1 AND 80
        )
    )
);

CREATE INDEX combo_component_product_idx ON catalog.combo_component (product_id);

CREATE TABLE cart.customer_cart_combo_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES cart.customer_cart(id) ON DELETE CASCADE,
  combo_product_id uuid NOT NULL REFERENCES catalog.combo(product_id) ON DELETE RESTRICT,
  combo_revision integer NOT NULL,
  configuration_hash text NOT NULL,
  quantity integer NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  unit_price_bdt integer NOT NULL,
  selections jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_cart_combo_line_configuration_uidx UNIQUE (cart_id, configuration_hash),
  CONSTRAINT customer_cart_combo_line_revision_check CHECK (combo_revision > 0),
  CONSTRAINT customer_cart_combo_line_quantity_check CHECK (quantity BETWEEN 1 AND 10),
  CONSTRAINT customer_cart_combo_line_hash_check CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_cart_combo_line_snapshot_check CHECK (
    jsonb_typeof(selections) = 'array' AND jsonb_array_length(selections) BETWEEN 2 AND 10
  ),
  CONSTRAINT customer_cart_combo_line_price_check CHECK (unit_price_bdt BETWEEN 0 AND 2147483647)
);

ALTER TABLE quote.snapshot
  ADD COLUMN combo_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE quote.snapshot
  ADD CONSTRAINT snapshot_combo_groups_array_check
  CHECK (jsonb_typeof(combo_groups) = 'array');

CREATE TABLE orders.combo_group (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders.order_header(id) ON DELETE RESTRICT,
  combo_product_id uuid NOT NULL REFERENCES catalog.product(id) ON DELETE RESTRICT,
  combo_revision integer NOT NULL,
  combo_name text NOT NULL,
  selection_mode text NOT NULL,
  quantity integer NOT NULL,
  unit_price_bdt bigint NOT NULL,
  gross_amount_bdt bigint NOT NULL,
  selections jsonb NOT NULL,
  delivery_outcome text NOT NULL DEFAULT 'pending',
  outcome_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_combo_group_revision_check CHECK (combo_revision > 0),
  CONSTRAINT order_combo_group_quantity_check CHECK (quantity BETWEEN 1 AND 10),
  CONSTRAINT order_combo_group_selection_mode_check
    CHECK (selection_mode IN ('fixed_combo', 'mix_colors_one_size', 'mix_sizes_and_colors')),
  CONSTRAINT order_combo_group_amount_check
    CHECK (unit_price_bdt BETWEEN 0 AND 9007199254740991
      AND gross_amount_bdt BETWEEN 0 AND 9007199254740991
      AND gross_amount_bdt = unit_price_bdt * quantity),
  CONSTRAINT order_combo_group_snapshot_check
    CHECK (jsonb_typeof(selections) = 'array' AND jsonb_array_length(selections) BETWEEN 2 AND 10),
  CONSTRAINT order_combo_group_outcome_check CHECK (
    delivery_outcome IN ('pending', 'complete', 'incomplete', 'redelivered_complete', 'declined')
    AND ((delivery_outcome = 'pending' AND outcome_reason IS NULL)
      OR (delivery_outcome <> 'pending' AND outcome_reason IS NOT NULL
        AND outcome_reason = btrim(outcome_reason)
        AND length(outcome_reason) BETWEEN 3 AND 500))
  )
);

CREATE INDEX order_combo_group_order_idx ON orders.combo_group(order_id, id);

ALTER TABLE orders.order_line
  ADD COLUMN combo_group_id uuid REFERENCES orders.combo_group(id) ON DELETE RESTRICT;

DROP INDEX orders.order_line_order_variant_uidx;
CREATE UNIQUE INDEX order_line_order_variant_group_uidx
  ON orders.order_line (
    order_id,
    variant_id,
    coalesce(combo_group_id, '00000000-0000-4000-8000-000000000000'::uuid)
  );

ALTER TABLE orders.order_header DROP CONSTRAINT order_amount_check;
ALTER TABLE orders.order_header
  ADD CONSTRAINT order_amount_check CHECK (
    merchandise_gross_bdt BETWEEN 0 AND 9007199254740991
    AND manual_discount_bdt BETWEEN 0 AND merchandise_gross_bdt
    AND delivery_amount_bdt BETWEEN 1 AND 9007199254740991
    AND total_bdt BETWEEN 1 AND 9007199254740991
    AND cod_amount_due_bdt BETWEEN 0 AND total_bdt
    AND total_bdt = merchandise_gross_bdt + delivery_amount_bdt - manual_discount_bdt
  );

ALTER TABLE orders.combo_group
  ADD COLUMN accepted_components jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE orders.combo_group
  ADD CONSTRAINT order_combo_group_accepted_components_check
  CHECK (
    jsonb_typeof(accepted_components) = 'array'
    AND jsonb_array_length(accepted_components) <= 10
  );

ALTER TABLE catalog.combo
  ADD COLUMN revision integer NOT NULL DEFAULT 1;

ALTER TABLE catalog.combo
  ADD CONSTRAINT combo_revision_check CHECK (revision > 0);

DO $$
DECLARE
  function_definition text;
  financial_amount_definition text := $definition$
  financial_amounts_changed := ROW(
    NEW."merchandise_gross_bdt", NEW."manual_discount_bdt", NEW."delivery_amount_bdt",
    NEW."total_bdt", NEW."cod_amount_due_bdt"
  ) IS DISTINCT FROM ROW(
    OLD."merchandise_gross_bdt", OLD."manual_discount_bdt", OLD."delivery_amount_bdt",
    OLD."total_bdt", OLD."cod_amount_due_bdt"
  );$definition$;
  financial_amount_definition_without_cod text := $definition$
  financial_amounts_changed := ROW(
    NEW."merchandise_gross_bdt", NEW."manual_discount_bdt", NEW."delivery_amount_bdt",
    NEW."total_bdt"
  ) IS DISTINCT FROM ROW(
    OLD."merchandise_gross_bdt", OLD."manual_discount_bdt", OLD."delivery_amount_bdt",
    OLD."total_bdt"
  );$definition$;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;

  IF position(financial_amount_definition IN function_definition) = 0
     OR position('> 50 THEN' IN function_definition) = 0
     OR position('  financial_amounts_changed := ROW(' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard does not match the expected combo reconciliation definition';
  END IF;

  function_definition := replace(
    function_definition,
    financial_amount_definition,
    financial_amount_definition_without_cod
  );
  function_definition := replace(
    function_definition,
    $find$  reservation_status text;
$find$,
    $replacement$  reservation_status text;
  accepted_merchandise_bdt numeric;
  expected_cod_amount_bdt numeric;
$replacement$
  );
  function_definition := replace(
    function_definition,
    '  financial_amounts_changed := ROW(',
    $block$  IF NEW."cod_amount_due_bdt" IS DISTINCT FROM OLD."cod_amount_due_bdt"
     AND (to_jsonb(NEW) - ARRAY['cod_amount_due_bdt', 'updated_at'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['cod_amount_due_bdt', 'updated_at']) THEN
    IF NEW."status" <> 'confirmed'
       OR NEW."fulfillment_status" NOT IN ('partially_delivered', 'delivered', 'delivery_failed', 'returned')
       OR NEW."collection_status" <> 'uncollected'
       OR NEW."collected_amount_bdt" IS NOT NULL
       OR NOT EXISTS (
         SELECT 1 FROM "orders"."combo_group" AS combo
         WHERE combo."order_id" = OLD."id"
       ) THEN
      RAISE EXCEPTION 'Combo COD can only be reconciled for an uncollected dispatched Order';
    END IF;

    SELECT
      CASE
        WHEN NEW."fulfillment_status" IN ('partially_delivered', 'delivered')
          THEN COALESCE((
            SELECT SUM(line."gross_amount_bdt")::numeric
            FROM "orders"."order_line" AS line
            WHERE line."order_id" = NEW."id"
              AND line."combo_group_id" IS NULL
          ), 0)
        ELSE 0
      END
      + COALESCE((
        SELECT SUM(
          CASE
            WHEN combo."delivery_outcome" IN ('complete', 'redelivered_complete')
              THEN combo."gross_amount_bdt"::numeric
            WHEN combo."delivery_outcome" IN ('incomplete', 'declined')
              THEN sets."complete_quantity" * combo."unit_price_bdt"::numeric
                + extras."amount"
            ELSE 0
          END
        )
        FROM "orders"."combo_group" AS combo
        CROSS JOIN LATERAL (
          SELECT COALESCE(MIN(COALESCE(accepted."quantity", 0)), 0)::numeric AS complete_quantity
          FROM jsonb_to_recordset(combo."selections")
            AS selection("componentId" uuid, "unitPriceBdt" bigint)
          LEFT JOIN jsonb_to_recordset(combo."accepted_components")
            AS accepted("componentId" uuid, "quantity" integer)
            ON accepted."componentId" = selection."componentId"
        ) AS sets
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(
            GREATEST(
              COALESCE(accepted."quantity", 0)::numeric - sets."complete_quantity",
              0
            ) * selection."unitPriceBdt"::numeric
          ), 0)::numeric AS amount
          FROM jsonb_to_recordset(combo."selections")
            AS selection("componentId" uuid, "unitPriceBdt" bigint)
          LEFT JOIN jsonb_to_recordset(combo."accepted_components")
            AS accepted("componentId" uuid, "quantity" integer)
            ON accepted."componentId" = selection."componentId"
        ) AS extras
        WHERE combo."order_id" = NEW."id"
      ), 0)
    INTO accepted_merchandise_bdt;

    expected_cod_amount_bdt := CASE
      WHEN accepted_merchandise_bdt = 0 THEN 0
      ELSE accepted_merchandise_bdt + NEW."delivery_amount_bdt"::numeric
        - NEW."manual_discount_bdt"::numeric
    END;
    IF expected_cod_amount_bdt < 0
       OR NEW."cod_amount_due_bdt"::numeric IS DISTINCT FROM expected_cod_amount_bdt
       OR NEW."cod_amount_due_bdt" > NEW."total_bdt" THEN
      RAISE EXCEPTION 'Combo COD must match the delivered items and saved prices';
    END IF;
    RETURN NEW;
  END IF;

  financial_amounts_changed := ROW($block$
  );
  function_definition := replace(function_definition, '> 50 THEN', '> 500 THEN');
  function_definition := replace(
    function_definition,
    'An Order cannot contain more than 50 item lines',
    'An Order cannot contain more than 500 physical item lines'
  );

  IF position(financial_amount_definition IN function_definition) > 0
     OR position('> 50 THEN' IN function_definition) > 0
     OR position('accepted_merchandise_bdt numeric' IN function_definition) = 0
     OR position('> 500 THEN' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard could not be updated for combo COD reconciliation';
  END IF;

  EXECUTE function_definition;
END;
$$;
