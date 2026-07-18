CREATE TABLE `graphs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`graph_json` text NOT NULL,
	`graph_hash` text NOT NULL,
	`thumbnail_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphs_owner_updated_idx` ON `graphs` (`owner_email`,`updated_at`);