CREATE OR REPLACE FUNCTION audit.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit.event is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit.event FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_update_delete
BEFORE UPDATE OR DELETE ON audit.event
FOR EACH ROW EXECUTE FUNCTION audit.reject_event_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
BEFORE TRUNCATE ON audit.event
FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_event_mutation();
