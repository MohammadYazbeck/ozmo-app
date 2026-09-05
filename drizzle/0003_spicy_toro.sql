CREATE TABLE `user_work_schedules` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`work_start` text,
	`work_end` text,
	`work_days` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_work_schedules_updated_idx` ON `user_work_schedules` (`updated_at`);