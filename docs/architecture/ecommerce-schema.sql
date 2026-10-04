-- Aaraj proposed enterprise model, PostgreSQL 16+. DOCUMENTATION, NOT AN APPLIED MIGRATION.
-- Target a disposable EMPTY database owned by a migration role with CREATE EXTENSION rights.
-- Never execute against an existing application database; derive reviewed owner migrations.
-- Future financial workflow examples use bigint amounts; launch catalog base prices are whole-BDT
-- integers in catalog.product_variant.price_bdt and are implemented in a separate migration.
-- UUID external references; business timestamps use timestamptz UTC;
-- Better Auth core columns follow its generated Drizzle schema.
-- No cross-context foreign keys. A UUID named *_ref is deliberately NOT a foreign key.
-- No cross-context joins, including reporting. Compose public APIs or event projections.
-- Application transactions stay inside ONE schema; orchestration uses persisted sagas.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA identity;
CREATE SCHEMA geography;
CREATE SCHEMA catalog;
CREATE SCHEMA inventory;
CREATE SCHEMA cart;
CREATE SCHEMA pricing;
CREATE SCHEMA ordering;
CREATE SCHEMA payment;
CREATE SCHEMA fulfillment;
CREATE SCHEMA notification;
CREATE SCHEMA audit;
CREATE SCHEMA moderation;
CREATE SCHEMA courier_ledger;
CREATE SCHEMA support;

-- INFRASTRUCTURE OWNED SEPARATELY BY EVERY CONTEXT, not a shared business repository.
-- The ID registry gives global event UUID uniqueness across time partitions. Retain it
-- through every replay window. Insert registry + event + aggregate + receipt atomically.
DO $ddl$
DECLARE owner_name text;
BEGIN
  FOREACH owner_name IN ARRAY ARRAY['identity','geography','catalog','inventory','cart',
    'pricing','ordering','payment','fulfillment','notification','audit','moderation',
    'courier_ledger','support'] LOOP
    EXECUTE format($table$
      CREATE TABLE %1$I.command_receipts (
        principal_scope text NOT NULL, operation text NOT NULL,
        idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
        request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
        status text NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED','RECONCILING')),
        response_status integer CHECK (response_status BETWEEN 100 AND 599),
        response_ciphertext bytea, resource_refs jsonb NOT NULL DEFAULT '{}',
        lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz, replay_until timestamptz NOT NULL,
        PRIMARY KEY (principal_scope, operation, idempotency_key),
        CHECK (replay_until >= created_at + interval '24 hours'),
        CHECK (status NOT IN ('SUCCEEDED','FAILED') OR completed_at IS NOT NULL)
      )$table$, owner_name);
    EXECUTE format($table$
      CREATE TABLE %1$I.outbox_event_ids (
        event_id uuid PRIMARY KEY, occurred_at timestamptz NOT NULL,
        aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
        aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
        event_index integer NOT NULL DEFAULT 0 CHECK (event_index >= 0),
        UNIQUE (event_id, occurred_at),
        UNIQUE (aggregate_type, aggregate_id, aggregate_version, event_index)
      )$table$, owner_name);
    EXECUTE format($table$
      CREATE TABLE %1$I.outbox_events (
        event_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
        event_type text NOT NULL, schema_version integer NOT NULL CHECK (schema_version > 0),
        correlation_id uuid NOT NULL, causation_id uuid,
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        available_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz, lease_until timestamptz, lease_token uuid,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error_code text, dead_lettered_at timestamptz,
        PRIMARY KEY (event_id, occurred_at),
        FOREIGN KEY (event_id, occurred_at)
          REFERENCES %1$I.outbox_event_ids(event_id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)$table$, owner_name);
    EXECUTE format('CREATE INDEX ON %I.outbox_events (available_at, occurred_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL', owner_name);
    EXECUTE format($table$
      CREATE TABLE %1$I.consumer_inbox (
        consumer_name text NOT NULL, producer_context text NOT NULL, event_id uuid NOT NULL,
        payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer_name, producer_context, event_id)
      )$table$, owner_name);
  END LOOP;
END $ddl$;

-- Better Auth core tables; authoritative Drizzle definitions live in
-- apps/api/src/auth/auth-schema.ts. Email/password is the launch sign-in method.
CREATE TABLE identity.user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE identity.session (
  id text PRIMARY KEY, expires_at timestamp NOT NULL, token text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL,
  ip_address text, user_agent text,
  user_id text NOT NULL REFERENCES identity.user(id) ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON identity.session(user_id);
CREATE TABLE identity.account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES identity.user(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamp, refresh_token_expires_at timestamp,
  scope text, password text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL
);
CREATE INDEX "account_userId_idx" ON identity.account(user_id);
CREATE TABLE identity.verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "verification_identifier_idx" ON identity.verification(identifier);
CREATE TABLE identity.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  description text NOT NULL, is_system boolean NOT NULL DEFAULT false
);
CREATE TABLE identity.permissions (
  code text PRIMARY KEY, description text NOT NULL, requires_step_up boolean NOT NULL DEFAULT false
);
CREATE TABLE identity.role_permissions (
  role_id uuid NOT NULL REFERENCES identity.roles(id),
  permission_code text NOT NULL REFERENCES identity.permissions(code),
  PRIMARY KEY (role_id, permission_code)
);
CREATE TABLE identity.user_roles (
  user_id text NOT NULL REFERENCES identity.user(id), role_id uuid NOT NULL REFERENCES identity.roles(id),
  scope_key text NOT NULL DEFAULT 'global', granted_by text REFERENCES identity.user(id),
  expires_at timestamptz, PRIMARY KEY (user_id, role_id, scope_key)
);
CREATE TABLE identity.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES identity.user(id),
  kind text NOT NULL CHECK (kind IN ('TOTP','WEBAUTHN')), secret_ciphertext bytea NOT NULL,
  key_version text NOT NULL, verified_at timestamptz, revoked_at timestamptz,
  last_accepted_counter bigint CHECK (last_accepted_counter >= 0)
);
CREATE TABLE identity.mfa_recovery_codes (
  factor_id uuid NOT NULL REFERENCES identity.mfa_factors(id), code_hash bytea NOT NULL,
  consumed_at timestamptz, PRIMARY KEY (factor_id, code_hash)
);
CREATE TABLE identity.step_up_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES identity.user(id),
  session_id text NOT NULL REFERENCES identity.session(id),
  permission_code text NOT NULL REFERENCES identity.permissions(code),
  target_ref uuid NOT NULL, command_digest bytea NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE identity.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES identity.user(id),
  area_ref uuid NOT NULL, geography_version text NOT NULL, address_ciphertext bytea NOT NULL,
  key_version text NOT NULL, label text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE identity.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES identity.user(id),
  purpose text NOT NULL, policy_version text NOT NULL, granted boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL
);

-- GEOGRAPHY: immutable versioned administrative datasets and courier mappings.
CREATE TABLE geography.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version text NOT NULL UNIQUE,
  source_uri text NOT NULL, source_sha256 bytea NOT NULL CHECK (octet_length(source_sha256) = 32),
  effective_from timestamptz NOT NULL, published_at timestamptz, retired_at timestamptz
);
CREATE TABLE geography.divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL REFERENCES geography.datasets(id),
  code text NOT NULL, name_en text NOT NULL, name_bn text NOT NULL,
  UNIQUE (dataset_id, code), UNIQUE (id, dataset_id)
);
CREATE TABLE geography.districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL,
  division_id uuid NOT NULL, code text NOT NULL, name_en text NOT NULL, name_bn text NOT NULL,
  FOREIGN KEY (division_id, dataset_id) REFERENCES geography.divisions(id, dataset_id),
  UNIQUE (dataset_id, code), UNIQUE (id, dataset_id)
);
CREATE TABLE geography.upazilas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL,
  district_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('UPAZILA','THANA')),
  code text NOT NULL, name_en text NOT NULL, name_bn text NOT NULL,
  FOREIGN KEY (district_id, dataset_id) REFERENCES geography.districts(id, dataset_id),
  UNIQUE (dataset_id, code), UNIQUE (id, dataset_id)
);
CREATE TABLE geography.areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL, upazila_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('UNION','WARD','AREA')), code text NOT NULL,
  name_en text NOT NULL, name_bn text NOT NULL, postal_code text,
  FOREIGN KEY (upazila_id, dataset_id) REFERENCES geography.upazilas(id, dataset_id),
  UNIQUE (dataset_id, code), UNIQUE (id, dataset_id)
);
CREATE TABLE geography.provider_zone_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), area_id uuid NOT NULL REFERENCES geography.areas(id),
  provider text NOT NULL, service_code text NOT NULL, mapping_version integer NOT NULL CHECK (mapping_version > 0),
  provider_city_code text, provider_zone_code text NOT NULL, provider_area_code text,
  serviceable boolean NOT NULL, valid_from timestamptz NOT NULL, valid_until timestamptz,
  UNIQUE (area_id, provider, service_code, mapping_version), CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- CATALOG: Bangladesh multilingual names; simple FTS + trigram with event-fed search adapter.
CREATE TABLE catalog.brands (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE catalog.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE, names jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX categories_parent_order_idx ON catalog.categories (parent_id, sort_order);
CREATE TABLE catalog.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_id uuid REFERENCES catalog.brands(id),
  category_id uuid REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE, title text NOT NULL, localized_content jsonb NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_attributes_gin ON catalog.products USING gin (attributes jsonb_path_ops);
CREATE INDEX products_title_trgm ON catalog.products USING gin (title gin_trgm_ops);
CREATE INDEX products_search_gin ON catalog.products USING gin (search_document);
CREATE INDEX products_category_idx ON catalog.products (category_id);
CREATE TABLE catalog.variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES catalog.products(id),
  sku text NOT NULL UNIQUE, barcode text, attributes jsonb NOT NULL DEFAULT '{}',
  weight_grams integer NOT NULL CHECK (weight_grams > 0), active boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, attributes)
);
CREATE INDEX variants_attributes_gin ON catalog.variants USING gin (attributes jsonb_path_ops);
CREATE TABLE catalog.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_key text NOT NULL UNIQUE,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32), mime_type text NOT NULL,
  byte_count bigint NOT NULL CHECK (byte_count > 0), scan_state text NOT NULL CHECK (scan_state IN ('PENDING','CLEAN','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog.media_derivatives (
  asset_id uuid NOT NULL REFERENCES catalog.media_assets(id), transform_version integer NOT NULL CHECK (transform_version > 0),
  format text NOT NULL CHECK (format IN ('AVIF','WEBP','JPEG','PNG')), width_px integer NOT NULL CHECK (width_px > 0),
  height_px integer NOT NULL CHECK (height_px > 0), object_key text NOT NULL UNIQUE,
  PRIMARY KEY (asset_id, transform_version, format, width_px, height_px)
);
CREATE TABLE catalog.product_media (
  product_id uuid NOT NULL REFERENCES catalog.products(id), asset_id uuid NOT NULL REFERENCES catalog.media_assets(id),
  position integer NOT NULL CHECK (position >= 0), alt_text jsonb NOT NULL,
  PRIMARY KEY (product_id, asset_id), UNIQUE (product_id, position)
);
CREATE TABLE catalog.search_projection_jobs (
  product_id uuid PRIMARY KEY REFERENCES catalog.products(id), target_version bigint NOT NULL CHECK (target_version > 0),
  indexed_version bigint NOT NULL DEFAULT 0 CHECK (indexed_version >= 0), last_error_code text
);

-- INVENTORY: physical_stock is saleable on-hand stock; quarantine is separate.
CREATE TABLE inventory.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  name text NOT NULL, area_ref uuid NOT NULL, address_ciphertext bytea NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE inventory.stock_items (
  warehouse_id uuid NOT NULL REFERENCES inventory.warehouses(id), variant_ref uuid NOT NULL,
  physical_stock bigint NOT NULL DEFAULT 0 CHECK (physical_stock >= 0),
  reserved_stock bigint NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  available_stock bigint GENERATED ALWAYS AS (physical_stock - reserved_stock) STORED,
  quarantined_stock bigint NOT NULL DEFAULT 0 CHECK (quarantined_stock >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (warehouse_id, variant_ref), CHECK (available_stock >= 0)
);
CREATE TABLE inventory.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), checkout_ref uuid NOT NULL,
  order_ref uuid, order_line_ref uuid NOT NULL, warehouse_id uuid NOT NULL, variant_ref uuid NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  state text NOT NULL CHECK (state IN ('HELD','CONFIRMED','COMMITTED','RELEASED','EXPIRED')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (warehouse_id, variant_ref) REFERENCES inventory.stock_items(warehouse_id, variant_ref),
  UNIQUE (checkout_ref, order_line_ref, warehouse_id, variant_ref), CHECK (expires_at > created_at)
);
CREATE INDEX ON inventory.reservations(expires_at) WHERE state = 'HELD';
CREATE TABLE inventory.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL, variant_ref uuid NOT NULL,
  reservation_id uuid REFERENCES inventory.reservations(id), source_ref text NOT NULL UNIQUE,
  physical_delta bigint NOT NULL, reserved_delta bigint NOT NULL, quarantine_delta bigint NOT NULL DEFAULT 0,
  reason text NOT NULL, actor_ref uuid, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (warehouse_id, variant_ref) REFERENCES inventory.stock_items(warehouse_id, variant_ref),
  CHECK (physical_delta <> 0 OR reserved_delta <> 0 OR quarantine_delta <> 0)
);
CREATE TABLE inventory.stock_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL, variant_ref uuid NOT NULL,
  requested_delta bigint NOT NULL CHECK (requested_delta <> 0), reason text NOT NULL,
  requested_by_ref uuid NOT NULL, approved_by_ref uuid, step_up_grant_ref uuid,
  state text NOT NULL CHECK (state IN ('PENDING','APPROVED','REJECTED','APPLIED')),
  FOREIGN KEY (warehouse_id, variant_ref) REFERENCES inventory.stock_items(warehouse_id, variant_ref),
  CHECK (approved_by_ref IS NULL OR approved_by_ref <> requested_by_ref)
);

-- CART: guest contents remain in signed Redis sessions for seven days.
CREATE TABLE cart.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL CHECK (state IN ('ACTIVE','CHECKED_OUT','ABANDONED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON cart.carts(customer_ref, currency) WHERE state = 'ACTIVE';
CREATE TABLE cart.cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cart_id uuid NOT NULL REFERENCES cart.carts(id),
  variant_ref uuid NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  observed_unit_amount bigint CHECK (observed_unit_amount >= 0), product_snapshot jsonb NOT NULL,
  UNIQUE (cart_id, variant_ref)
);
CREATE TABLE cart.merge_receipts (
  guest_session_hash bytea PRIMARY KEY, cart_id uuid NOT NULL REFERENCES cart.carts(id),
  merge_policy_version integer NOT NULL CHECK (merge_policy_version > 0), merged_at timestamptz NOT NULL DEFAULT now()
);

-- PRICING: rules are versioned; exact rational conversion and deterministic allocation.
CREATE TABLE pricing.price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), tax_inclusive boolean NOT NULL
);
CREATE TABLE pricing.prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), price_list_id uuid NOT NULL REFERENCES pricing.price_lists(id),
  variant_ref uuid NOT NULL, minimum_quantity integer NOT NULL CHECK (minimum_quantity > 0),
  unit_amount bigint NOT NULL CHECK (unit_amount >= 0), valid_from timestamptz NOT NULL, valid_until timestamptz,
  UNIQUE (price_list_id, variant_ref, minimum_quantity, valid_from), CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE TABLE pricing.tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), jurisdiction text NOT NULL, tax_code text NOT NULL,
  version integer NOT NULL CHECK (version > 0), numerator integer NOT NULL CHECK (numerator >= 0),
  denominator integer NOT NULL CHECK (denominator > 0), valid_from timestamptz NOT NULL,
  valid_until timestamptz, legal_reference text NOT NULL,
  UNIQUE (jurisdiction, tax_code, version), CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE TABLE pricing.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_currency text NOT NULL, quote_currency text NOT NULL,
  numerator bigint NOT NULL CHECK (numerator > 0), denominator bigint NOT NULL CHECK (denominator > 0),
  base_scale integer NOT NULL CHECK (base_scale BETWEEN 0 AND 6), quote_scale integer NOT NULL CHECK (quote_scale BETWEEN 0 AND 6),
  provider text NOT NULL, quoted_at timestamptz NOT NULL, CHECK (base_currency <> quote_currency)
);
CREATE TABLE pricing.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL CHECK (kind IN ('PERCENT','FIXED','BUNDLE','BUY_X_GET_Y','FLASH','SHIPPING')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), rules jsonb NOT NULL,
  discount_amount bigint CHECK (discount_amount >= 0), discount_bps integer CHECK (discount_bps BETWEEN 0 AND 10000),
  minimum_spend bigint NOT NULL DEFAULT 0 CHECK (minimum_spend >= 0), priority integer NOT NULL DEFAULT 0,
  stacking_group text NOT NULL, stackable boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  global_limit bigint CHECK (global_limit > 0), per_customer_limit integer CHECK (per_customer_limit > 0),
  UNIQUE (code, version), CHECK (ends_at > starts_at)
);
CREATE TABLE pricing.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotion_id uuid NOT NULL REFERENCES pricing.promotions(id),
  code_hash bytea NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true
);
CREATE TABLE pricing.promotion_counters (
  promotion_id uuid PRIMARY KEY REFERENCES pricing.promotions(id),
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0), redeemed bigint NOT NULL DEFAULT 0 CHECK (redeemed >= 0)
);
CREATE TABLE pricing.customer_promotion_counters (
  promotion_id uuid NOT NULL REFERENCES pricing.promotions(id), customer_ref uuid NOT NULL,
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0), redeemed bigint NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  PRIMARY KEY (promotion_id, customer_ref)
);
CREATE TABLE pricing.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid, cart_ref uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), pricing_version text NOT NULL,
  subtotal_amount bigint NOT NULL CHECK (subtotal_amount >= 0), discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0), shipping_amount bigint NOT NULL CHECK (shipping_amount >= 0),
  total_amount bigint NOT NULL CHECK (total_amount >= 0), expires_at timestamptz NOT NULL,
  CHECK (discount_amount <= subtotal_amount), CHECK (total_amount = subtotal_amount - discount_amount + tax_amount + shipping_amount)
);
CREATE TABLE pricing.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES pricing.quotes(id),
  variant_ref uuid NOT NULL, quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount bigint NOT NULL CHECK (unit_amount >= 0), discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0), total_amount bigint NOT NULL CHECK (total_amount >= 0),
  tax_rule_snapshot jsonb NOT NULL, CHECK (discount_amount <= unit_amount * quantity),
  CHECK (total_amount = unit_amount * quantity - discount_amount + tax_amount), UNIQUE (id, quote_id)
);
CREATE TABLE pricing.discount_allocations (
  quote_line_id uuid NOT NULL REFERENCES pricing.quote_lines(id), promotion_id uuid NOT NULL REFERENCES pricing.promotions(id),
  allocated_amount bigint NOT NULL CHECK (allocated_amount >= 0), allocation_rank integer NOT NULL CHECK (allocation_rank >= 0),
  PRIMARY KEY (quote_line_id, promotion_id)
);
CREATE TABLE pricing.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotion_id uuid NOT NULL REFERENCES pricing.promotions(id),
  coupon_id uuid REFERENCES pricing.coupons(id), quote_id uuid NOT NULL REFERENCES pricing.quotes(id),
  customer_ref uuid NOT NULL, order_ref uuid, state text NOT NULL CHECK (state IN ('HELD','COMMITTED','RELEASED','EXPIRED')),
  expires_at timestamptz NOT NULL, UNIQUE (promotion_id, quote_id)
);

-- ORDERING: globally unique IDs and numbers are stored outside monthly partitions.
CREATE TABLE ordering.order_ids (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, order_number text NOT NULL UNIQUE,
  checkout_ref uuid NOT NULL UNIQUE, UNIQUE (id, created_at)
);
CREATE TABLE ordering.orders (
  id uuid NOT NULL, created_at timestamptz NOT NULL,
  customer_ref uuid NOT NULL, quote_ref uuid NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL CHECK (state IN ('CHECKOUT_PENDING','AWAITING_ADVANCE','AWAITING_PAYMENT','FLAGGED_FOR_REVIEW',
    'CONFIRMED','ALLOCATING','FULFILLING','PARTIALLY_SHIPPED','SHIPPED','DELIVERED','CANCEL_PENDING','CANCELLED','CLOSED')),
  payment_method text NOT NULL CHECK (payment_method IN ('PREPAID','COD','COD_WITH_ADVANCE')),
  subtotal_amount bigint NOT NULL CHECK (subtotal_amount >= 0), discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0), shipping_amount bigint NOT NULL CHECK (shipping_amount >= 0),
  total_amount bigint NOT NULL CHECK (total_amount >= 0), required_advance_amount bigint NOT NULL DEFAULT 0 CHECK (required_advance_amount >= 0),
  customer_snapshot_ciphertext bytea NOT NULL, initial_address_ciphertext bytea NOT NULL, pii_key_version text NOT NULL,
  geography_snapshot jsonb NOT NULL, pricing_policy_snapshot jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (id, created_at), FOREIGN KEY (id, created_at) REFERENCES ordering.order_ids(id, created_at),
  CHECK (discount_amount <= subtotal_amount), CHECK (total_amount = subtotal_amount - discount_amount + tax_amount + shipping_amount),
  CHECK (required_advance_amount <= total_amount), CHECK (payment_method <> 'COD' OR required_advance_amount = 0),
  CHECK (payment_method <> 'COD_WITH_ADVANCE' OR required_advance_amount > 0)
) PARTITION BY RANGE (created_at);
CREATE INDEX ON ordering.orders(customer_ref, created_at DESC);
CREATE INDEX ON ordering.orders(state, created_at);
CREATE TABLE ordering.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  variant_ref uuid NOT NULL, product_snapshot jsonb NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_amount bigint NOT NULL CHECK (unit_amount >= 0), discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0), total_amount bigint NOT NULL CHECK (total_amount >= 0),
  tax_snapshot jsonb NOT NULL, FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at),
  CHECK (discount_amount <= unit_amount * quantity), CHECK (total_amount = unit_amount * quantity - discount_amount + tax_amount),
  UNIQUE (id, order_id, order_created_at)
);
CREATE TABLE ordering.line_discount_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_line_id uuid NOT NULL REFERENCES ordering.order_lines(id),
  promotion_ref uuid NOT NULL, promotion_snapshot jsonb NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0), allocation_rank integer NOT NULL CHECK (allocation_rank >= 0)
);
CREATE TABLE ordering.order_address_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision > 0), address_ciphertext bytea NOT NULL, geography_snapshot jsonb NOT NULL,
  actor_ref uuid NOT NULL, reason text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at),
  UNIQUE (order_id, order_created_at, revision)
);
CREATE TABLE ordering.order_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  from_state text, to_state text NOT NULL, reason_code text NOT NULL, actor_ref uuid,
  correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at)
);
CREATE TABLE ordering.checkout_sagas (
  checkout_id uuid PRIMARY KEY, order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('DRAFT','VALIDATING','FLAGGED_FOR_REVIEW','RESERVING','AWAITING_PAYMENT',
    'CONFIRMING','COMPENSATING','CANCELLING','CONFIRMED','FULFILLING','COMPLETED','CANCELLED')),
  reservations_snapshot jsonb NOT NULL DEFAULT '[]', payment_ref uuid,
  next_step text NOT NULL, attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at)
);
CREATE TABLE ordering.risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  ruleset_version text NOT NULL, score integer NOT NULL CHECK (score BETWEEN 0 AND 10000),
  decision text NOT NULL CHECK (decision IN ('ALLOW','ADVANCE_REQUIRED','REVIEW','DENY')),
  signals_redacted jsonb NOT NULL, required_advance_amount bigint NOT NULL CHECK (required_advance_amount >= 0),
  assessed_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at)
);
CREATE TABLE ordering.fraud_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assessment_id uuid NOT NULL REFERENCES ordering.risk_assessments(id),
  state text NOT NULL CHECK (state IN ('QUEUED','CLAIMED','APPROVED','REJECTED','EXPIRED')),
  reviewer_ref uuid, reason_code text, decided_at timestamptz, step_up_grant_ref uuid
);
CREATE TABLE ordering.customer_risk_projections (
  customer_ref uuid PRIMARY KEY, delivered_count bigint NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  rts_count bigint NOT NULL DEFAULT 0 CHECK (rts_count >= 0),
  source_version bigint NOT NULL CHECK (source_version > 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ordering.tax_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, order_created_at timestamptz NOT NULL,
  invoice_number text NOT NULL UNIQUE, invoice_type text NOT NULL CHECK (invoice_type IN ('SALE','CREDIT_NOTE','DEBIT_NOTE')),
  original_invoice_id uuid REFERENCES ordering.tax_invoices(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), issued_at timestamptz NOT NULL,
  supplier_snapshot jsonb NOT NULL, buyer_snapshot_ciphertext bytea NOT NULL,
  taxable_amount bigint NOT NULL CHECK (taxable_amount >= 0), tax_amount bigint NOT NULL CHECK (tax_amount >= 0),
  supplementary_duty_amount bigint NOT NULL DEFAULT 0 CHECK (supplementary_duty_amount >= 0),
  total_amount bigint NOT NULL CHECK (total_amount >= 0), supply_at timestamptz NOT NULL,
  transport_snapshot jsonb NOT NULL, tax_policy_version text NOT NULL,
  template_version text NOT NULL, document_object_key text, document_sha256 bytea,
  FOREIGN KEY (order_id, order_created_at) REFERENCES ordering.orders(id, created_at),
  CHECK (total_amount = taxable_amount + tax_amount + supplementary_duty_amount),
  CHECK ((invoice_type = 'SALE') = (original_invoice_id IS NULL))
);
CREATE TABLE ordering.tax_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES ordering.tax_invoices(id),
  order_line_id uuid REFERENCES ordering.order_lines(id), item_kind text NOT NULL CHECK (item_kind IN ('GOODS','SHIPPING','ADJUSTMENT')),
  description_snapshot text NOT NULL, hs_code text, unit_code text NOT NULL, quantity integer NOT NULL CHECK (quantity > 0),
  taxable_amount bigint NOT NULL CHECK (taxable_amount >= 0), vat_amount bigint NOT NULL CHECK (vat_amount >= 0),
  supplementary_duty_amount bigint NOT NULL DEFAULT 0 CHECK (supplementary_duty_amount >= 0), rate_snapshot jsonb NOT NULL
);
CREATE TABLE ordering.tax_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_start date NOT NULL, period_end date NOT NULL,
  format_version text NOT NULL, object_key text NOT NULL UNIQUE,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32), created_at timestamptz NOT NULL DEFAULT now(), CHECK (period_end >= period_start)
);
CREATE TABLE ordering.tax_export_invoices (
  export_id uuid NOT NULL REFERENCES ordering.tax_exports(id), invoice_id uuid NOT NULL REFERENCES ordering.tax_invoices(id),
  PRIMARY KEY (export_id, invoice_id)
);

-- PAYMENT: never trust a browser redirect; a capture requires server verification.
CREATE TABLE payment.intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('ORDER_PAYMENT','COD_ADVANCE','BALANCE_PAYMENT')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), amount bigint NOT NULL CHECK (amount > 0),
  captured_amount bigint NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  refund_reserved_amount bigint NOT NULL DEFAULT 0 CHECK (refund_reserved_amount >= 0),
  state text NOT NULL CHECK (state IN ('CREATED','PENDING','CAPTURED','FAILED','CANCELLED','UNKNOWN','PARTIALLY_REFUNDED','REFUNDED')),
  merchant_reference text NOT NULL UNIQUE, version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (captured_amount <= amount), CHECK (refunded_amount + refund_reserved_amount <= captured_amount),
  UNIQUE (id, currency)
);
CREATE TABLE payment.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intent_id uuid NOT NULL REFERENCES payment.intents(id),
  provider text NOT NULL CHECK (provider IN ('BKASH','NAGAD','SSLCOMMERZ','AAMARPAY')),
  merchant_account_ref text NOT NULL, provider_idempotency_key text NOT NULL,
  provider_payment_ref text, state text NOT NULL CHECK (state IN ('CREATED','SENT','PENDING','VERIFIED','FAILED','UNKNOWN')),
  request_hash bytea NOT NULL, provider_token_ciphertext bytea,
  created_at timestamptz NOT NULL DEFAULT now(), last_verified_at timestamptz, next_reconcile_at timestamptz,
  UNIQUE (provider, merchant_account_ref, provider_idempotency_key), UNIQUE (provider, merchant_account_ref, provider_payment_ref),
  UNIQUE (id, intent_id)
);
CREATE TABLE payment.webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, merchant_account_ref text NOT NULL,
  deduplication_key text NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  payload_ciphertext bytea NOT NULL, signature_verified boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, processed_at timestamptz,
  state text NOT NULL CHECK (state IN ('RECEIVED','VERIFYING','APPLIED','REJECTED','RETRY','DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), next_attempt_at timestamptz,
  UNIQUE (provider, merchant_account_ref, deduplication_key)
);
CREATE TABLE payment.cod_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref uuid NOT NULL, shipment_ref uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), amount bigint NOT NULL CHECK (amount > 0),
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  refund_reserved_amount bigint NOT NULL DEFAULT 0 CHECK (refund_reserved_amount >= 0),
  provider text NOT NULL, merchant_account_ref text NOT NULL, provider_consignment_ref text NOT NULL,
  provider_collection_ref text NOT NULL, source_event_ref uuid NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL, settlement_state text NOT NULL CHECK (settlement_state IN ('PENDING','SETTLED','DISPUTED')),
  CHECK (refunded_amount + refund_reserved_amount <= amount),
  UNIQUE (provider, merchant_account_ref, provider_collection_ref),
  UNIQUE (id, currency)
);
CREATE TABLE payment.cod_collection_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod_collection_id uuid NOT NULL REFERENCES payment.cod_collections(id),
  order_line_ref uuid, component text NOT NULL CHECK (component IN ('GOODS','TAX','SHIPPING')),
  amount bigint NOT NULL CHECK (amount > 0),
  UNIQUE NULLS NOT DISTINCT (cod_collection_id, order_line_ref, component),
  UNIQUE (id, cod_collection_id)
);
CREATE TABLE payment.captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intent_id uuid NOT NULL, attempt_id uuid NOT NULL,
  currency text NOT NULL, amount bigint NOT NULL CHECK (amount > 0),
  provider text NOT NULL, merchant_account_ref text NOT NULL, provider_transaction_ref text NOT NULL,
  verified_at timestamptz NOT NULL, settlement_state text NOT NULL CHECK (settlement_state IN ('PENDING','SETTLED','DISPUTED')),
  FOREIGN KEY (intent_id, currency) REFERENCES payment.intents(id, currency),
  FOREIGN KEY (attempt_id, intent_id) REFERENCES payment.attempts(id, intent_id),
  UNIQUE (provider, merchant_account_ref, provider_transaction_ref), UNIQUE (id, intent_id)
);
CREATE TABLE payment.capture_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capture_id uuid NOT NULL REFERENCES payment.captures(id),
  order_line_ref uuid, component text NOT NULL CHECK (component IN ('GOODS','TAX','SHIPPING','ADVANCE')),
  amount bigint NOT NULL CHECK (amount > 0), UNIQUE NULLS NOT DISTINCT (capture_id, order_line_ref, component),
  UNIQUE (id, capture_id)
);
CREATE TABLE payment.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intent_id uuid, capture_id uuid, cod_collection_id uuid,
  return_ref uuid, command_reference text NOT NULL UNIQUE, amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL CHECK (state IN ('REQUESTED','AUTHORIZED','SENT','UNKNOWN','SUCCEEDED','FAILED')),
  authorized_by_ref uuid, step_up_grant_ref uuid, reason_code text NOT NULL,
  provider_refund_ref text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  FOREIGN KEY (capture_id, intent_id) REFERENCES payment.captures(id, intent_id),
  FOREIGN KEY (cod_collection_id, currency) REFERENCES payment.cod_collections(id, currency),
  CHECK ((capture_id IS NOT NULL AND intent_id IS NOT NULL AND cod_collection_id IS NULL)
      OR (capture_id IS NULL AND intent_id IS NULL AND cod_collection_id IS NOT NULL)),
  UNIQUE (id, capture_id, cod_collection_id)
);
CREATE TABLE payment.refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES payment.refunds(id),
  capture_id uuid REFERENCES payment.captures(id), cod_collection_id uuid REFERENCES payment.cod_collections(id),
  capture_allocation_id uuid, cod_collection_allocation_id uuid,
  amount bigint NOT NULL CHECK (amount > 0), quantity integer CHECK (quantity > 0),
  FOREIGN KEY (capture_allocation_id, capture_id)
    REFERENCES payment.capture_allocations(id, capture_id),
  FOREIGN KEY (cod_collection_allocation_id, cod_collection_id)
    REFERENCES payment.cod_collection_allocations(id, cod_collection_id),
  CHECK ((capture_allocation_id IS NOT NULL AND capture_id IS NOT NULL
          AND cod_collection_allocation_id IS NULL AND cod_collection_id IS NULL)
      OR (capture_allocation_id IS NULL AND capture_id IS NULL
          AND cod_collection_allocation_id IS NOT NULL AND cod_collection_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (refund_id, capture_allocation_id, cod_collection_allocation_id)
);
CREATE TABLE payment.refund_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES payment.refunds(id),
  rail text NOT NULL CHECK (rail IN ('ORIGINAL_PROVIDER','BKASH','NAGAD','BANK_TRANSFER','WALLET','MANUAL')),
  merchant_reference text NOT NULL UNIQUE, provider_reference text,
  amount bigint NOT NULL CHECK (amount > 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  beneficiary_ciphertext bytea, state text NOT NULL CHECK (state IN ('CREATED','SENT','UNKNOWN','VERIFIED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz,
  UNIQUE (provider_reference, rail)
);
CREATE FUNCTION payment.ensure_refund_source_matches() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_capture uuid; target_cod uuid;
BEGIN
  SELECT capture_id, cod_collection_id INTO target_capture, target_cod
    FROM payment.refunds WHERE id = NEW.refund_id FOR UPDATE;
  IF NOT FOUND OR target_capture IS DISTINCT FROM NEW.capture_id
      OR target_cod IS DISTINCT FROM NEW.cod_collection_id THEN
    RAISE EXCEPTION 'Refund allocation source must match its refund funding source';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER refund_source_matches BEFORE INSERT OR UPDATE ON payment.refund_allocations
  FOR EACH ROW EXECUTE FUNCTION payment.ensure_refund_source_matches();
CREATE TABLE payment.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PENDING_PAYMENT','SETTLEMENT','REFUND')),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, cursor_ciphertext bytea,
  state text NOT NULL CHECK (state IN ('RUNNING','COMPLETE','FAILED'))
);
CREATE TABLE payment.reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES payment.reconciliation_runs(id),
  attempt_id uuid REFERENCES payment.attempts(id), refund_id uuid REFERENCES payment.refunds(id),
  discrepancy_code text, verified_payload_ciphertext bytea NOT NULL, resolution text,
  CHECK (num_nonnulls(attempt_id, refund_id) = 1)
);
CREATE TABLE payment.settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, merchant_account_ref text NOT NULL,
  provider_batch_ref text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_amount bigint NOT NULL CHECK (gross_amount >= 0), fee_amount bigint NOT NULL CHECK (fee_amount >= 0),
  net_amount bigint NOT NULL CHECK (net_amount >= 0), settled_at timestamptz NOT NULL,
  UNIQUE (provider, merchant_account_ref, provider_batch_ref), CHECK (net_amount = gross_amount - fee_amount)
);
CREATE TABLE payment.settlement_items (
  batch_id uuid NOT NULL REFERENCES payment.settlement_batches(id), capture_id uuid NOT NULL UNIQUE REFERENCES payment.captures(id),
  gross_amount bigint NOT NULL CHECK (gross_amount > 0), fee_amount bigint NOT NULL CHECK (fee_amount >= 0),
  PRIMARY KEY (batch_id, capture_id), CHECK (fee_amount <= gross_amount)
);
-- Optional wallet refund destination: payment owns credits and the customer balance.
CREATE TABLE payment.wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), balance_amount bigint NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), UNIQUE (customer_ref, currency)
);
CREATE TABLE payment.wallet_ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_code text NOT NULL,
  customer_ref uuid, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  account_kind text NOT NULL CHECK (account_kind IN ('CUSTOMER_LIABILITY','WALLET_CLEARING','BANK','REFUND_EXPENSE')),
  UNIQUE NULLS NOT DISTINCT (account_code, customer_ref, currency),
  UNIQUE (id, currency),
  CHECK ((account_kind = 'CUSTOMER_LIABILITY') = (customer_ref IS NOT NULL))
);
CREATE TABLE payment.wallet_ledger_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_reference text NOT NULL UNIQUE,
  refund_id uuid NOT NULL UNIQUE REFERENCES payment.refunds(id), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL CHECK (state IN ('DRAFT','POSTED')), created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz, UNIQUE (id, currency), UNIQUE (id, refund_id),
  CHECK (state <> 'POSTED' OR posted_at IS NOT NULL)
);
CREATE TABLE payment.wallet_ledger_postings (
  journal_id uuid NOT NULL, line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL, currency text NOT NULL, signed_amount bigint NOT NULL CHECK (signed_amount <> 0),
  PRIMARY KEY (journal_id, line_number),
  FOREIGN KEY (journal_id, currency) REFERENCES payment.wallet_ledger_journals(id, currency),
  FOREIGN KEY (account_id, currency) REFERENCES payment.wallet_ledger_accounts(id, currency)
);
CREATE FUNCTION payment.guard_wallet_posting() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_id uuid; journal_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD.journal_id; ELSE target_id := NEW.journal_id; END IF;
  SELECT state INTO journal_state FROM payment.wallet_ledger_journals WHERE id = target_id FOR UPDATE;
  IF journal_state = 'POSTED' THEN RAISE EXCEPTION 'Posted wallet journal is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER guard_wallet_posting BEFORE INSERT OR UPDATE OR DELETE ON payment.wallet_ledger_postings
  FOR EACH ROW EXECUTE FUNCTION payment.guard_wallet_posting();
CREATE FUNCTION payment.check_wallet_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_id uuid; journal_state text; line_count bigint; total numeric;
BEGIN
  IF TG_TABLE_NAME = 'wallet_ledger_journals' THEN target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_id := OLD.journal_id;
  ELSE target_id := NEW.journal_id; END IF;
  SELECT state INTO journal_state FROM payment.wallet_ledger_journals WHERE id = target_id;
  IF journal_state = 'POSTED' THEN
    SELECT count(*), coalesce(sum(signed_amount), 0) INTO line_count, total
      FROM payment.wallet_ledger_postings WHERE journal_id = target_id;
    IF line_count < 2 OR total <> 0 THEN RAISE EXCEPTION 'Wallet journal must balance with at least two lines'; END IF;
  END IF;
  RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER wallet_journal_balance AFTER INSERT OR UPDATE ON payment.wallet_ledger_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment.check_wallet_journal_balance();
CREATE CONSTRAINT TRIGGER wallet_posting_balance AFTER INSERT OR UPDATE OR DELETE ON payment.wallet_ledger_postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment.check_wallet_journal_balance();
CREATE FUNCTION payment.guard_posted_wallet_journal() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.state = 'POSTED' THEN RAISE EXCEPTION 'Posted wallet journal is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER immutable_posted_wallet_journal BEFORE UPDATE OR DELETE ON payment.wallet_ledger_journals
  FOR EACH ROW EXECUTE FUNCTION payment.guard_posted_wallet_journal();
CREATE TABLE payment.wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES payment.wallet_accounts(id),
  ledger_journal_ref uuid NOT NULL UNIQUE,
  refund_id uuid UNIQUE REFERENCES payment.refunds(id), source_reference text NOT NULL UNIQUE,
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0), balance_after bigint NOT NULL CHECK (balance_after >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payment.wallet_entries ALTER COLUMN refund_id SET NOT NULL;
ALTER TABLE payment.wallet_entries ADD CONSTRAINT wallet_entry_refund_journal_fk
  FOREIGN KEY (ledger_journal_ref, refund_id)
  REFERENCES payment.wallet_ledger_journals(id, refund_id);


-- FULFILLMENT: warehouse/stock/order IDs are opaque; snapshots arrive through contracts.
CREATE TABLE fulfillment.fulfillment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref uuid NOT NULL, warehouse_ref uuid NOT NULL,
  split_sequence integer NOT NULL CHECK (split_sequence > 0),
  state text NOT NULL CHECK (state IN ('PLANNED','PICKING','PACKED','BOOKING','DISPATCHED','CANCELLED','COMPLETE')),
  recipient_ciphertext bytea NOT NULL, geography_snapshot jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), UNIQUE (order_ref, split_sequence)
);
CREATE TABLE fulfillment.fulfillment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fulfillment_order_id uuid NOT NULL REFERENCES fulfillment.fulfillment_orders(id),
  order_line_ref uuid NOT NULL, variant_ref uuid NOT NULL, reservation_ref uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0), item_snapshot jsonb NOT NULL,
  UNIQUE (fulfillment_order_id, order_line_ref, reservation_ref)
);
CREATE TABLE fulfillment.courier_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL CHECK (provider IN ('PATHAO','STEADFAST','REDX')),
  merchant_account_ref text NOT NULL, secret_locator text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE (provider, merchant_account_ref)
);
CREATE TABLE fulfillment.booking_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fulfillment_order_id uuid NOT NULL REFERENCES fulfillment.fulfillment_orders(id),
  courier_account_id uuid NOT NULL REFERENCES fulfillment.courier_accounts(id),
  merchant_consignment_ref text NOT NULL UNIQUE, provider_consignment_ref text,
  state text NOT NULL CHECK (state IN ('CREATED','SENT','BOOKED','FAILED','UNKNOWN','CANCELLED')),
  request_hash bytea NOT NULL, last_verified_at timestamptz,
  UNIQUE (courier_account_id, provider_consignment_ref)
);
CREATE TABLE fulfillment.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_attempt_id uuid NOT NULL UNIQUE REFERENCES fulfillment.booking_attempts(id),
  fulfillment_order_id uuid NOT NULL REFERENCES fulfillment.fulfillment_orders(id),
  tracking_number text NOT NULL, state text NOT NULL CHECK (state IN ('BOOKED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
    'DELIVERED','PARTIALLY_DELIVERED','REFUSED','RTS_IN_TRANSIT','RTS_RECEIVED','LOST','CANCELLED')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cod_due_amount bigint NOT NULL CHECK (cod_due_amount >= 0), cod_collected_amount bigint NOT NULL DEFAULT 0 CHECK (cod_collected_amount >= 0),
  provider_zone_snapshot jsonb NOT NULL, fee_contract_snapshot jsonb NOT NULL,
  label_object_key text, dispatched_at timestamptz, delivered_at timestamptz,
  next_poll_at timestamptz, version bigint NOT NULL DEFAULT 1 CHECK (version > 0), CHECK (cod_collected_amount <= cod_due_amount)
);
CREATE TABLE fulfillment.shipment_lines (
  shipment_id uuid NOT NULL REFERENCES fulfillment.shipments(id), fulfillment_line_id uuid NOT NULL REFERENCES fulfillment.fulfillment_lines(id),
  quantity integer NOT NULL CHECK (quantity > 0), delivered_quantity integer NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
  rejected_quantity integer NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  PRIMARY KEY (shipment_id, fulfillment_line_id), CHECK (delivered_quantity + rejected_quantity <= quantity)
);
CREATE TABLE fulfillment.courier_webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), courier_account_id uuid NOT NULL REFERENCES fulfillment.courier_accounts(id),
  deduplication_key text NOT NULL, payload_hash bytea NOT NULL, payload_ciphertext bytea NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, verified_at timestamptz,
  state text NOT NULL CHECK (state IN ('RECEIVED','APPLIED','REJECTED','RETRY','DEAD_LETTER')),
  UNIQUE (courier_account_id, deduplication_key)
);
CREATE TABLE fulfillment.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid NOT NULL REFERENCES fulfillment.shipments(id),
  source text NOT NULL CHECK (source IN ('WEBHOOK','POLL','OPERATOR')), deduplication_key text NOT NULL,
  provider_status text NOT NULL, normalized_status text NOT NULL, provider_occurred_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (shipment_id, deduplication_key)
);
CREATE TABLE fulfillment.return_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref uuid NOT NULL, customer_ref uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('POST_DELIVERY','DOORSTEP_REFUSAL','COURIER_RTS')),
  state text NOT NULL CHECK (state IN ('REQUESTED','AUTHORIZED','REJECTED','IN_TRANSIT','RECEIVED','INSPECTED','REFUND_PENDING','CLOSED')),
  reason_code text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  maximum_refund_amount bigint NOT NULL CHECK (maximum_refund_amount >= 0),
  restocking_fee_amount bigint NOT NULL DEFAULT 0 CHECK (restocking_fee_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (restocking_fee_amount <= maximum_refund_amount)
);
CREATE TABLE fulfillment.return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), return_id uuid NOT NULL REFERENCES fulfillment.return_authorizations(id),
  shipment_id uuid NOT NULL, fulfillment_line_id uuid NOT NULL, order_line_ref uuid NOT NULL,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0), received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  refundable_amount bigint NOT NULL CHECK (refundable_amount >= 0), financial_allocation_snapshot jsonb NOT NULL,
  FOREIGN KEY (shipment_id, fulfillment_line_id) REFERENCES fulfillment.shipment_lines(shipment_id, fulfillment_line_id),
  CHECK (received_quantity <= requested_quantity), UNIQUE (return_id, shipment_id, fulfillment_line_id)
);
CREATE TABLE fulfillment.return_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), return_line_id uuid NOT NULL REFERENCES fulfillment.return_lines(id),
  warehouse_ref uuid NOT NULL, grade text NOT NULL CHECK (grade IN ('SELLABLE','REPAIR','DAMAGED','FRAUD_REVIEW')),
  quantity integer NOT NULL CHECK (quantity > 0), inspector_ref uuid NOT NULL,
  evidence_object_keys jsonb NOT NULL DEFAULT '[]', inspected_at timestamptz NOT NULL DEFAULT now(), restock_command_ref uuid UNIQUE
);

-- COURIER LEDGER: double entry, one currency per journal, append-only posted records.
CREATE TABLE courier_ledger.courier_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, merchant_account_ref text NOT NULL,
  version integer NOT NULL CHECK (version > 0), effective_from timestamptz NOT NULL, effective_until timestamptz,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), zone_snapshot jsonb NOT NULL,
  delivery_fee_amount bigint NOT NULL CHECK (delivery_fee_amount >= 0), return_fee_amount bigint NOT NULL CHECK (return_fee_amount >= 0),
  cod_fee_numerator integer NOT NULL CHECK (cod_fee_numerator >= 0), cod_fee_denominator integer NOT NULL CHECK (cod_fee_denominator > 0),
  fee_basis text NOT NULL CHECK (fee_basis IN ('COLLECTED_COD','ORDER_TOTAL','CONTRACT_RULE')),
  rounding_rule text NOT NULL, tax_rule_snapshot jsonb NOT NULL,
  UNIQUE (provider, merchant_account_ref, version), CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE TABLE courier_ledger.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  kind text NOT NULL CHECK (kind IN ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY')),
  provider_ref text, UNIQUE (code, currency), UNIQUE (id, currency)
);
CREATE TABLE courier_ledger.journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_reference text NOT NULL UNIQUE,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL CHECK (state IN ('DRAFT','POSTED')), reversal_of uuid REFERENCES courier_ledger.journals(id),
  description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  UNIQUE (id, currency), CHECK (state <> 'POSTED' OR posted_at IS NOT NULL), CHECK (reversal_of IS DISTINCT FROM id)
);
CREATE TABLE courier_ledger.postings (
  journal_id uuid NOT NULL, line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL, currency text NOT NULL, signed_amount bigint NOT NULL CHECK (signed_amount <> 0),
  shipment_ref uuid, order_ref uuid, PRIMARY KEY (journal_id, line_number),
  FOREIGN KEY (journal_id, currency) REFERENCES courier_ledger.journals(id, currency),
  FOREIGN KEY (account_id, currency) REFERENCES courier_ledger.accounts(id, currency)
);
CREATE TABLE courier_ledger.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_ref uuid NOT NULL UNIQUE, order_ref uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES courier_ledger.courier_contracts(id), journal_id uuid NOT NULL REFERENCES courier_ledger.journals(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), cod_collected_amount bigint NOT NULL CHECK (cod_collected_amount >= 0),
  delivery_fee_amount bigint NOT NULL CHECK (delivery_fee_amount >= 0), commission_amount bigint NOT NULL CHECK (commission_amount >= 0),
  tax_amount bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  expected_net_amount bigint NOT NULL, settled_amount bigint NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  due_at timestamptz NOT NULL, state text NOT NULL CHECK (state IN ('OPEN','PARTIAL','SETTLED','DISPUTED','WRITTEN_OFF')),
  CHECK (expected_net_amount = cod_collected_amount - delivery_fee_amount - commission_amount - tax_amount)
);
CREATE TABLE courier_ledger.remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, merchant_account_ref text NOT NULL,
  provider_remittance_ref text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  bank_amount bigint NOT NULL CHECK (bank_amount >= 0), received_at timestamptz NOT NULL,
  statement_object_key text NOT NULL, statement_sha256 bytea NOT NULL CHECK (octet_length(statement_sha256) = 32),
  state text NOT NULL CHECK (state IN ('IMPORTED','MATCHING','RECONCILED','EXCEPTION')),
  UNIQUE (provider, merchant_account_ref, provider_remittance_ref)
);
CREATE TABLE courier_ledger.remittance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), remittance_id uuid NOT NULL REFERENCES courier_ledger.remittances(id),
  line_number integer NOT NULL CHECK (line_number > 0), provider_consignment_ref text NOT NULL,
  claimed_cod_amount bigint NOT NULL CHECK (claimed_cod_amount >= 0), claimed_fee_amount bigint NOT NULL CHECK (claimed_fee_amount >= 0),
  claimed_net_amount bigint NOT NULL, UNIQUE (remittance_id, line_number),
  CHECK (claimed_net_amount = claimed_cod_amount - claimed_fee_amount)
);
CREATE TABLE courier_ledger.remittance_allocations (
  remittance_line_id uuid NOT NULL REFERENCES courier_ledger.remittance_lines(id),
  receivable_id uuid NOT NULL REFERENCES courier_ledger.receivables(id), journal_id uuid NOT NULL REFERENCES courier_ledger.journals(id),
  signed_amount bigint NOT NULL CHECK (signed_amount <> 0), PRIMARY KEY (remittance_line_id, receivable_id)
);
CREATE TABLE courier_ledger.discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receivable_id uuid REFERENCES courier_ledger.receivables(id),
  remittance_line_id uuid REFERENCES courier_ledger.remittance_lines(id),
  code text NOT NULL, expected_amount bigint NOT NULL, actual_amount bigint NOT NULL,
  variance_amount bigint GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,
  state text NOT NULL CHECK (state IN ('OPEN','INVESTIGATING','ACCEPTED','RESOLVED')),
  resolution_journal_id uuid REFERENCES courier_ledger.journals(id), reviewed_by_ref uuid,
  CHECK (num_nonnulls(receivable_id, remittance_line_id) >= 1)
);
CREATE FUNCTION courier_ledger.guard_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.state = 'POSTED' THEN RAISE EXCEPTION 'Posted journals are immutable; create a reversal'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER immutable_posted_journal BEFORE UPDATE OR DELETE ON courier_ledger.journals
  FOR EACH ROW EXECUTE FUNCTION courier_ledger.guard_posted_journal();
CREATE FUNCTION courier_ledger.guard_posting() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_id uuid; journal_state text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.journal_id <> OLD.journal_id THEN
    RAISE EXCEPTION 'Move a draft posting by delete and insert';
  END IF;
  IF TG_OP = 'DELETE' THEN target_id := OLD.journal_id; ELSE target_id := NEW.journal_id; END IF;
  SELECT state INTO journal_state FROM courier_ledger.journals WHERE id = target_id FOR UPDATE;
  IF journal_state = 'POSTED' THEN RAISE EXCEPTION 'Posted entries are immutable; create a reversal'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER immutable_posted_entry BEFORE INSERT OR UPDATE OR DELETE ON courier_ledger.postings
  FOR EACH ROW EXECUTE FUNCTION courier_ledger.guard_posting();
CREATE FUNCTION courier_ledger.check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_id uuid; journal_state text; entry_count bigint; total numeric;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_id := OLD.journal_id;
  ELSE target_id := NEW.journal_id; END IF;
  SELECT state INTO journal_state FROM courier_ledger.journals WHERE id = target_id;
  IF journal_state = 'POSTED' THEN
    SELECT count(*), coalesce(sum(signed_amount), 0) INTO entry_count, total
      FROM courier_ledger.postings WHERE journal_id = target_id;
    IF entry_count < 2 OR total <> 0 THEN RAISE EXCEPTION 'Journal % must have at least two balanced postings', target_id; END IF;
  END IF;
  RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT OR UPDATE ON courier_ledger.journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION courier_ledger.check_journal_balance();
CREATE CONSTRAINT TRIGGER balanced_postings AFTER INSERT OR UPDATE OR DELETE ON courier_ledger.postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION courier_ledger.check_journal_balance();

-- NOTIFICATION: provider ingress/channel credentials, delivery intent/history and CAPI.
-- Support consumes verified normalized events and owns conversations/order drafting.
CREATE TABLE notification.social_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL CHECK (provider IN ('WHATSAPP','MESSENGER')),
  external_account_ref text NOT NULL, credential_secret_locator text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE (provider, external_account_ref)
);
CREATE TABLE notification.social_webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_id uuid NOT NULL REFERENCES notification.social_channels(id),
  external_event_ref text NOT NULL, payload_hash bytea NOT NULL, payload_ciphertext bytea NOT NULL,
  signature_verified boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  state text NOT NULL CHECK (state IN ('RECEIVED','APPLIED','REJECTED','RETRY','DEAD_LETTER')),
  UNIQUE (channel_id, external_event_ref)
);
CREATE TABLE notification.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, version integer NOT NULL CHECK (version > 0),
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP','MESSENGER','PUSH')),
  locale text NOT NULL, provider_template_ref text, body_object_key text NOT NULL,
  UNIQUE (code, version, channel, locale)
);
CREATE TABLE notification.preferences (
  customer_ref uuid NOT NULL, channel text NOT NULL, category text NOT NULL,
  enabled boolean NOT NULL, consent_ref uuid, version bigint NOT NULL CHECK (version > 0),
  PRIMARY KEY (customer_ref, channel, category)
);
CREATE TABLE notification.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES notification.templates(id),
  customer_ref uuid, business_event_ref uuid NOT NULL, deduplication_key text NOT NULL UNIQUE,
  recipient_ciphertext bytea NOT NULL, parameters_ciphertext bytea NOT NULL, key_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','SENDING','SENT','DELIVERED','FAILED','SUPPRESSED','DEAD_LETTER')),
  correlation_id uuid NOT NULL, not_before timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification.delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES notification.messages(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0), provider text NOT NULL, provider_message_ref text,
  status text NOT NULL, safe_error_code text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (message_id, attempt_number)
);
CREATE TABLE notification.dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES notification.messages(id),
  failed_at timestamptz NOT NULL DEFAULT now(), reason_code text NOT NULL, payload_hash bytea NOT NULL,
  state text NOT NULL CHECK (state IN ('OPEN','REPLAYED','DISCARDED')), replayed_by_ref uuid, replayed_at timestamptz,
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0)
);
CREATE TABLE notification.delivery_receipts (
  provider text NOT NULL, provider_event_ref text NOT NULL, message_id uuid NOT NULL REFERENCES notification.messages(id),
  status text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, provider_event_ref)
);
CREATE TABLE notification.analytics_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL CHECK (provider IN ('META_CAPI','GA4')),
  event_name text NOT NULL, event_id text NOT NULL, source_event_ref uuid NOT NULL,
  consent_snapshot jsonb NOT NULL, payload_ciphertext bytea NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','SENT','SUPPRESSED','FAILED','DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), next_attempt_at timestamptz,
  UNIQUE (provider, event_name, event_id)
);

-- AUDIT: append-only application access + hash chain + external WORM anchors.
CREATE TABLE audit.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_context text NOT NULL,
  shard_key text NOT NULL, last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_hash bytea, UNIQUE (source_context, shard_key)
);
CREATE TABLE audit.audit_ids (
  id uuid PRIMARY KEY, occurred_at timestamptz NOT NULL,
  source_context text NOT NULL, source_event_ref uuid NOT NULL,
  UNIQUE (id, occurred_at), UNIQUE (source_context, source_event_ref)
);
CREATE TABLE audit.audit_logs (
  id uuid NOT NULL, occurred_at timestamptz NOT NULL,
  stream_id uuid NOT NULL REFERENCES audit.streams(id), sequence bigint NOT NULL CHECK (sequence > 0),
  actor_ref uuid, impersonator_ref uuid, subject_type text NOT NULL, subject_ref uuid,
  action text NOT NULL, correlation_id uuid NOT NULL,
  ip_hash bytea, before_redacted jsonb, after_redacted jsonb,
  previous_hash bytea, entry_hash bytea NOT NULL CHECK (octet_length(entry_hash) = 32),
  PRIMARY KEY (id, occurred_at), FOREIGN KEY (id, occurred_at) REFERENCES audit.audit_ids(id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ON audit.audit_logs(stream_id, sequence);
CREATE INDEX ON audit.audit_logs(subject_type, subject_ref, occurred_at DESC);
CREATE TABLE audit.chain_positions (
  stream_id uuid NOT NULL REFERENCES audit.streams(id), sequence bigint NOT NULL CHECK (sequence > 0),
  audit_id uuid NOT NULL UNIQUE REFERENCES audit.audit_ids(id), entry_hash bytea NOT NULL,
  PRIMARY KEY (stream_id, sequence), UNIQUE (stream_id, sequence, audit_id, entry_hash)
);
ALTER TABLE audit.audit_logs ADD CONSTRAINT audit_chain_position_fk
  FOREIGN KEY (stream_id, sequence, id, entry_hash)
  REFERENCES audit.chain_positions(stream_id, sequence, audit_id, entry_hash);
CREATE TABLE audit.external_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stream_id uuid NOT NULL REFERENCES audit.streams(id),
  through_sequence bigint NOT NULL CHECK (through_sequence > 0), chain_hash bytea NOT NULL,
  worm_object_key text NOT NULL UNIQUE, external_signature bytea NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now(), UNIQUE (stream_id, through_sequence)
);
CREATE FUNCTION audit.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Immutable audit records cannot be updated or deleted'; END $fn$;
CREATE TRIGGER immutable_audit_logs BEFORE UPDATE OR DELETE ON audit.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER immutable_audit_ids BEFORE UPDATE OR DELETE ON audit.audit_ids
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER immutable_chain_positions BEFORE UPDATE OR DELETE ON audit.chain_positions
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER immutable_external_anchors BEFORE UPDATE OR DELETE ON audit.external_anchors
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

-- MODERATION: eligibility facts are event-fed local projections, never joined to orders.
CREATE TABLE moderation.purchase_eligibility (
  order_line_ref uuid PRIMARY KEY, customer_ref uuid NOT NULL, product_ref uuid NOT NULL,
  delivered_at timestamptz NOT NULL, eligible boolean NOT NULL, source_version bigint NOT NULL CHECK (source_version > 0)
);
CREATE TABLE moderation.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid NOT NULL, product_ref uuid NOT NULL,
  order_line_ref uuid REFERENCES moderation.purchase_eligibility(order_line_ref),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), body text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','PUBLISHED','HIDDEN','REJECTED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON moderation.reviews(order_line_ref) WHERE order_line_ref IS NOT NULL;
CREATE TABLE moderation.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid REFERENCES moderation.reviews(id),
  subject_type text NOT NULL, subject_ref uuid NOT NULL, rule_version text NOT NULL,
  reason_code text NOT NULL, state text NOT NULL CHECK (state IN ('OPEN','CLAIMED','RESOLVED','APPEALED')),
  assigned_to_ref uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE moderation.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES moderation.cases(id),
  decision text NOT NULL, actor_ref uuid NOT NULL, reason_code text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE moderation.bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_ref uuid NOT NULL, action text NOT NULL,
  scope_snapshot jsonb NOT NULL, state text NOT NULL CHECK (state IN ('QUEUED','RUNNING','COMPLETE','PARTIAL','FAILED')),
  requested_count integer NOT NULL CHECK (requested_count > 0), succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0), CHECK (succeeded_count + failed_count <= requested_count)
);
CREATE TABLE moderation.bulk_job_items (
  job_id uuid NOT NULL REFERENCES moderation.bulk_jobs(id), subject_ref uuid NOT NULL,
  command_ref uuid NOT NULL UNIQUE, state text NOT NULL, error_code text,
  PRIMARY KEY (job_id, subject_ref)
);

-- SUPPORT: CRM, social commerce ingress, and consent-filtered analytics delivery.
CREATE TABLE support.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid, order_ref uuid,
  subject_ciphertext bytea NOT NULL, state text NOT NULL CHECK (state IN ('OPEN','ASSIGNED','WAITING','RESOLVED','CLOSED')),
  priority text NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  assignee_ref uuid, created_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE support.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES support.tickets(id),
  actor_ref uuid, kind text NOT NULL CHECK (kind IN ('CUSTOMER','AGENT','INTERNAL','SYSTEM')),
  body_ciphertext bytea NOT NULL, attachment_keys jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.customer_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_ref uuid NOT NULL,
  source_context text NOT NULL, source_event_ref uuid NOT NULL, occurred_at timestamptz NOT NULL,
  event_type text NOT NULL, redacted_summary jsonb NOT NULL,
  UNIQUE (source_context, source_event_ref)
);
CREATE INDEX ON support.customer_timeline(customer_ref, occurred_at DESC);
CREATE TABLE support.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_ref uuid NOT NULL, customer_ref uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES support.tickets(id), step_up_grant_ref uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('READ_ONLY','ASSIST_CART')), reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK (actor_ref <> customer_ref), CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes')
);
CREATE TABLE support.address_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES support.tickets(id),
  order_ref uuid NOT NULL, expected_order_version bigint NOT NULL CHECK (expected_order_version > 0),
  proposed_address_ciphertext bytea NOT NULL, actor_ref uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','ACCEPTED','REJECTED')), owner_command_ref uuid NOT NULL UNIQUE,
  reason_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_ref uuid NOT NULL,
  external_conversation_hash bytea NOT NULL, participant_ciphertext bytea NOT NULL,
  customer_ref uuid, ticket_id uuid REFERENCES support.tickets(id),
  verified_identity_at timestamptz, last_inbound_at timestamptz, UNIQUE (channel_id, external_conversation_hash)
);
CREATE TABLE support.social_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES support.conversations(id),
  external_message_ref text NOT NULL, direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  content_ciphertext bytea NOT NULL, sent_at timestamptz NOT NULL,
  notification_ref uuid, UNIQUE (conversation_id, external_message_ref)
);
CREATE TABLE support.social_order_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES support.conversations(id),
  source_message_id uuid NOT NULL REFERENCES support.social_messages(id),
  operation text NOT NULL CHECK (operation IN ('DRAFT_CART','PLACE_ORDER','CONFIRM_COD','TRACK_ORDER')),
  order_ref uuid, command_receipt_ref text NOT NULL UNIQUE, identity_proof_ref uuid,
  state text NOT NULL CHECK (state IN ('PENDING','AWAITING_CUSTOMER','DISPATCHED','SUCCEEDED','REJECTED'))
);

-- PARTITION PROVISIONING EXAMPLE: previous month, current month, next three months.
-- Production migration/maintenance identity runs equivalent reviewed DDL ahead of time.
-- Deliberately no default partitions: a missing future partition fails visibly, never
-- silently accumulates unbounded data. Alert when fewer than two future partitions exist.
DO $partitions$
DECLARE owner_name text; partition_month date; next_month date; suffix text; offset_month integer;
BEGIN
  FOR offset_month IN -1..3 LOOP
    partition_month := (date_trunc('month', now()) + make_interval(months => offset_month))::date;
    next_month := (partition_month + interval '1 month')::date;
    suffix := to_char(partition_month, 'YYYY_MM');
    FOREACH owner_name IN ARRAY ARRAY['identity','geography','catalog','inventory','cart','pricing',
      'ordering','payment','fulfillment','notification','audit','moderation','courier_ledger','support'] LOOP
      EXECUTE format('CREATE TABLE %I.%I PARTITION OF %I.outbox_events FOR VALUES FROM (%L) TO (%L)',
        owner_name, 'outbox_events_' || suffix, owner_name, partition_month, next_month);
    END LOOP;
    EXECUTE format('CREATE TABLE ordering.%I PARTITION OF ordering.orders FOR VALUES FROM (%L) TO (%L)',
      'orders_' || suffix, partition_month, next_month);
    EXECUTE format('CREATE TABLE audit.%I PARTITION OF audit.audit_logs FOR VALUES FROM (%L) TO (%L)',
      'audit_logs_' || suffix, partition_month, next_month);
  END LOOP;
END $partitions$;

-- Privilege plan (deploy separately with named login roles and reviewed GRANTs):
-- * Schema owners are NOLOGIN migration roles; application roles cannot own tables.
-- * Owner repository credentials receive USAGE + required DML only on their schema.
-- * REVOKE public schema CREATE, public function EXECUTE, cross-owner USAGE and DML.
-- * Audit application role receives INSERT only on audit immutable tables, SELECT/UPDATE
--   only on streams for serialized chain heads; verifier receives SELECT separately.
-- * Outbox relays may SELECT and update delivery columns only, not payload/event IDs.
-- * No app role can TRUNCATE, ALTER, DROP, DISABLE TRIGGER, set replication role, or
--   edit posted ledger rows. DBA actions require external audit and WORM verification.
-- * Future partitions inherit access through parent-table access; avoid granting direct
--   partition DML. Grant carefully on sequences if future migrations introduce them.
COMMIT;
