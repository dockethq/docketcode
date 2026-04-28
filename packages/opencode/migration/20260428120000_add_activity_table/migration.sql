CREATE TABLE IF NOT EXISTS `activity` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`todo_id` text,
	`tool` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`file_path` text,
	`content` text,
	`child_session_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_activity_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_session_idx` ON `activity` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_session_time_idx` ON `activity` (`session_id`,`time_created`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_todo_idx` ON `activity` (`todo_id`);
