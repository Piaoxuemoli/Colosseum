CREATE TABLE `elo_ratings` (
	`agent_id` text NOT NULL,
	`game_type` text NOT NULL,
	`rating` integer DEFAULT 1000 NOT NULL,
	`matches_played` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`last_delta` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	PRIMARY KEY(`agent_id`, `game_type`)
);
--> statement-breakpoint
CREATE INDEX `elo_ratings_game_idx` ON `elo_ratings` (`game_type`);