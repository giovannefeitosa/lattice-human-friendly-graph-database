CREATE TABLE `graph_views` (
	`id` text PRIMARY KEY NOT NULL,
	`graph_id` text NOT NULL,
	`name` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`positions_json` text DEFAULT '{}' NOT NULL,
	`focus_root_id` text,
	`collapsed_node_ids_json` text DEFAULT '[]' NOT NULL,
	`pinned_node_ids_json` text DEFAULT '[]' NOT NULL,
	`viewport_json` text DEFAULT '{"x":360,"y":300,"zoom":1}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`graph_id`) REFERENCES `graphs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graph_views_graph_updated_idx` ON `graph_views` (`graph_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `graph_views_graph_name_unique` ON `graph_views` (`graph_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `graph_views_one_primary_per_graph` ON `graph_views` (`graph_id`) WHERE "graph_views"."is_primary" = 1;--> statement-breakpoint
INSERT INTO `graph_views` (
	`id`,
	`graph_id`,
	`name`,
	`is_primary`,
	`positions_json`,
	`focus_root_id`,
	`collapsed_node_ids_json`,
	`pinned_node_ids_json`,
	`viewport_json`,
	`created_at`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`graphs`.`id`,
	'Principal',
	1,
	coalesce((
		SELECT json_group_object(
			json_extract(`node`.`value`, '$.id'),
			json_object(
				'x', json_extract(`node`.`value`, '$.x'),
				'y', json_extract(`node`.`value`, '$.y')
			)
		)
		FROM json_each(`graphs`.`graph_json`, '$.nodes') AS `node`
	), '{}'),
	NULL,
	'[]',
	'[]',
	'{"x":360,"y":300,"zoom":1}',
	`graphs`.`created_at`,
	`graphs`.`updated_at`
FROM `graphs`;
