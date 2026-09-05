CREATE TABLE `activity_log_hides` (
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`hidden_by_user_id` integer NOT NULL,
	`hidden_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`source_type`, `source_id`),
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `activity_log_hides_actor_idx` ON `activity_log_hides` (`hidden_by_user_id`);--> statement-breakpoint
CREATE TABLE `inventory_period_snapshots` (
	`period_id` integer NOT NULL,
	`client_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`closing_quantity` integer NOT NULL,
	`carry_quantity` integer NOT NULL,
	`reset_delta` integer NOT NULL,
	PRIMARY KEY(`period_id`, `client_id`, `content_type`),
	FOREIGN KEY (`period_id`) REFERENCES `inventory_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_period_snapshots_closing_nonnegative" CHECK("inventory_period_snapshots"."closing_quantity" >= 0),
	CONSTRAINT "inventory_period_snapshots_carry_valid" CHECK("inventory_period_snapshots"."carry_quantity" >= 0 AND "inventory_period_snapshots"."carry_quantity" <= "inventory_period_snapshots"."closing_quantity")
);
--> statement-breakpoint
CREATE INDEX `inventory_period_snapshots_client_idx` ON `inventory_period_snapshots` (`client_id`);--> statement-breakpoint
CREATE TABLE `inventory_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`closed_by_user_id` integer NOT NULL,
	`closed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_periods_label_unique` ON `inventory_periods` (`label`);--> statement-breakpoint
CREATE INDEX `inventory_periods_closed_idx` ON `inventory_periods` (`closed_at`);--> statement-breakpoint
CREATE TABLE `report_corrections` (
	`report_id` integer PRIMARY KEY NOT NULL,
	`corrected_by_user_id` integer NOT NULL,
	`corrected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corrected_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `session_deletions` (
	`session_id` integer PRIMARY KEY NOT NULL,
	`deleted_by_user_id` integer NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `session_deletions_actor_idx` ON `session_deletions` (`deleted_by_user_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `reels_shot` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `is_correction` integer DEFAULT false NOT NULL;