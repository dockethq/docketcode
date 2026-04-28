-- Recreate todo table with id as primary key (SQLite cannot alter primary key in place)
CREATE TABLE `todo_new` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`position` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_todo_new_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `todo_new` SELECT 'tod' || lower(hex(randomblob(16))), `session_id`, `content`, `status`, `priority`, `position`, `time_created`, `time_updated` FROM `todo`;
--> statement-breakpoint
DROP TABLE `todo`;
--> statement-breakpoint
ALTER TABLE `todo_new` RENAME TO `todo`;
--> statement-breakpoint
CREATE INDEX `todo_session_idx` ON `todo` (`session_id`);
