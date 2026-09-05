CREATE TABLE `inventory_events_shot_reel_migration` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`delta` integer NOT NULL,
	`event_type` text NOT NULL,
	`task_id` integer,
	`actor_user_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`occurred_on` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `inventory_events_content_type` CHECK (`content_type` IN ('draft','shot_reel','reel','post'))
);
--> statement-breakpoint
INSERT INTO `inventory_events_shot_reel_migration` (
	`id`,`client_id`,`content_type`,`delta`,`event_type`,`task_id`,
	`actor_user_id`,`note`,`occurred_on`,`created_at`
)
SELECT
	`id`,`client_id`,`content_type`,`delta`,`event_type`,`task_id`,
	`actor_user_id`,`note`,`occurred_on`,`created_at`
FROM `inventory_events`;
--> statement-breakpoint
DROP TABLE `inventory_events`;
--> statement-breakpoint
ALTER TABLE `inventory_events_shot_reel_migration` RENAME TO `inventory_events`;
--> statement-breakpoint
CREATE INDEX `inventory_client_type_idx` ON `inventory_events` (`client_id`,`content_type`);
--> statement-breakpoint
CREATE INDEX `inventory_date_idx` ON `inventory_events` (`occurred_on`);
--> statement-breakpoint
CREATE INDEX `inventory_task_idx` ON `inventory_events` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_session_event_unique` ON `inventory_events` (`event_type`) WHERE `event_type` LIKE 'session_shot_reels:%';
--> statement-breakpoint
CREATE TABLE `inventory_balances_shot_reel_migration` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `inventory_balances_content_type` CHECK (`content_type` IN ('draft','shot_reel','reel','post')),
	CONSTRAINT `inventory_balances_nonnegative` CHECK (`quantity` >= 0)
);
--> statement-breakpoint
INSERT INTO `inventory_balances_shot_reel_migration` (
	`id`,`client_id`,`content_type`,`quantity`,`updated_at`
)
SELECT `id`,`client_id`,`content_type`,`quantity`,`updated_at`
FROM `inventory_balances`;
--> statement-breakpoint
DROP TABLE `inventory_balances`;
--> statement-breakpoint
ALTER TABLE `inventory_balances_shot_reel_migration` RENAME TO `inventory_balances`;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_balances_client_type_unique` ON `inventory_balances` (`client_id`,`content_type`);
--> statement-breakpoint
INSERT OR IGNORE INTO `inventory_balances` (`client_id`,`content_type`,`quantity`)
SELECT `id`,'shot_reel',0 FROM `clients`;
--> statement-breakpoint
CREATE TABLE `inventory_period_snapshots_shot_reel_migration` (
	`period_id` integer NOT NULL,
	`client_id` integer NOT NULL,
	`content_type` text NOT NULL,
	`closing_quantity` integer NOT NULL,
	`carry_quantity` integer NOT NULL,
	`reset_delta` integer NOT NULL,
	PRIMARY KEY(`period_id`,`client_id`,`content_type`),
	FOREIGN KEY (`period_id`) REFERENCES `inventory_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `inventory_period_snapshots_content_type` CHECK (`content_type` IN ('draft','shot_reel','reel','post')),
	CONSTRAINT `inventory_period_snapshots_closing_nonnegative` CHECK (`closing_quantity` >= 0),
	CONSTRAINT `inventory_period_snapshots_carry_valid` CHECK (`carry_quantity` >= 0 AND `carry_quantity` <= `closing_quantity`)
);
--> statement-breakpoint
INSERT INTO `inventory_period_snapshots_shot_reel_migration` (
	`period_id`,`client_id`,`content_type`,`closing_quantity`,
	`carry_quantity`,`reset_delta`
)
SELECT
	`period_id`,`client_id`,`content_type`,`closing_quantity`,
	`carry_quantity`,`reset_delta`
FROM `inventory_period_snapshots`;
--> statement-breakpoint
DROP TABLE `inventory_period_snapshots`;
--> statement-breakpoint
ALTER TABLE `inventory_period_snapshots_shot_reel_migration` RENAME TO `inventory_period_snapshots`;
--> statement-breakpoint
CREATE INDEX `inventory_period_snapshots_client_idx` ON `inventory_period_snapshots` (`client_id`);
