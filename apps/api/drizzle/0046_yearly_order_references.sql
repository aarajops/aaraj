CREATE TABLE "orders"."order_reference_counter" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "order_reference_counter_year_check" CHECK ("orders"."order_reference_counter"."year" between 1 and 9999),
	CONSTRAINT "order_reference_counter_number_check" CHECK ("orders"."order_reference_counter"."last_number" between 1 and 99999)
);
--> statement-breakpoint
ALTER TABLE "delivery"."pathao_booking" DROP CONSTRAINT "pathao_booking_reference_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_reference_check";--> statement-breakpoint
ALTER TABLE "delivery"."pathao_booking" ADD CONSTRAINT "pathao_booking_reference_check" CHECK ("delivery"."pathao_booking"."merchant_order_id" ~ '^(AA-[0-9A-F]{12}|ORD-[0-9]{3}-[0-9]{5})$');--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_reference_check" CHECK ("orders"."order_header"."reference" ~ '^(AA-[0-9A-F]{12}|ORD-[0-9]{3}-[0-9]{5})$');