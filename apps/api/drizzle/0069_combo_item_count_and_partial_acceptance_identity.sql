DROP INDEX "orders"."order_line_order_variant_group_uidx";--> statement-breakpoint
ALTER TABLE "catalog"."combo" ADD COLUMN "item_count" integer;--> statement-breakpoint
UPDATE "catalog"."combo" AS combo
SET "item_count" = (
  SELECT count(*)::integer
  FROM "catalog"."combo_component" AS component
  WHERE component."combo_product_id" = combo."product_id"
);--> statement-breakpoint
ALTER TABLE "catalog"."combo" ALTER COLUMN "item_count" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_order_variant_group_uidx" ON "orders"."order_line" USING btree ("order_id","variant_id") WHERE "orders"."order_line"."combo_group_id" is null;--> statement-breakpoint
ALTER TABLE "catalog"."combo" ADD CONSTRAINT "combo_item_count_check" CHECK ("catalog"."combo"."item_count" between 2 and 10);--> statement-breakpoint
-- Some local databases applied an earlier combo schema without the COD guard
-- reconciliation. Bring that guard forward before adding selection identity.
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

  IF position('accepted_merchandise_bdt numeric' IN function_definition) = 0 THEN
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
  END IF;
END;
$$;--> statement-breakpoint
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;

  IF position('AS selection("componentId" uuid, "unitPriceBdt" bigint)' IN function_definition) = 0
     OR position('AS accepted("componentId" uuid, "quantity" integer)' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard does not match the expected combo reconciliation definition';
  END IF;

  function_definition := regexp_replace(
    function_definition,
    'AS selection[[:space:]]*\([[:space:]]*"componentId"[[:space:]]+uuid,[[:space:]]*"unitPriceBdt"[[:space:]]+bigint[[:space:]]*\)',
    'AS selection("selectionIndex" integer, "componentId" uuid, "unitPriceBdt" bigint)',
    'g'
  );
  function_definition := regexp_replace(
    function_definition,
    'AS accepted[[:space:]]*\([[:space:]]*"componentId"[[:space:]]+uuid,[[:space:]]*"quantity"[[:space:]]+integer[[:space:]]*\)[[:space:]]+ON[[:space:]]+accepted\."componentId"[[:space:]]*=[[:space:]]*selection\."componentId"',
    'AS accepted("selectionIndex" integer, "componentId" uuid, "quantity" integer) ON ((selection."selectionIndex" IS NOT NULL AND accepted."selectionIndex" = selection."selectionIndex") OR (selection."selectionIndex" IS NULL AND accepted."selectionIndex" IS NULL AND accepted."componentId" = selection."componentId"))',
    'g'
  );

  IF position('AS selection("selectionIndex" integer' IN function_definition) = 0
     OR position('accepted."selectionIndex" = selection."selectionIndex"' IN function_definition) = 0
     OR position('AS accepted("componentId" uuid, "quantity" integer)' IN function_definition) > 0 THEN
    RAISE EXCEPTION 'Order update guard could not be updated for combo item selection identity';
  END IF;

  EXECUTE function_definition;
END;
$$;
