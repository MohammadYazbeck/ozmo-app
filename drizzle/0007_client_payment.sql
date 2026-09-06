ALTER TABLE `clients` ADD `remaining_payment_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `remaining_payment_currency` text DEFAULT 'USD' NOT NULL;
