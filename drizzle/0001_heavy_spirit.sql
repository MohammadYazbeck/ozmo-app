CREATE TABLE `notification_states` (
	`key` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`last_value` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notifications_recipient_dedupe` ON `notifications` (`recipient_user_id`,`dedupe_key`);