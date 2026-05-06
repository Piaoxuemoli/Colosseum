CREATE TABLE `agent_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`occurred_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`layer` text NOT NULL,
	`error_code` text NOT NULL,
	`raw_response` text,
	`recovery_action` text
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`game_type` text NOT NULL,
	`kind` text DEFAULT 'player' NOT NULL,
	`profile_id` text NOT NULL,
	`system_prompt` text NOT NULL,
	`avatar_emoji` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `api_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_game_type_kind_idx` ON `agents` (`game_type`,`kind`);--> statement-breakpoint
CREATE TABLE `episodic_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`observer_agent_id` text NOT NULL,
	`target_agent_id` text,
	`match_id` text NOT NULL,
	`game_type` text NOT NULL,
	`entry_json` text NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `episodic_obs_target_idx` ON `episodic_memory` (`observer_agent_id`,`target_agent_id`,`game_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `episodic_obs_gametype_idx` ON `episodic_memory` (`observer_agent_id`,`game_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seq` integer NOT NULL,
	`occurred_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`kind` text NOT NULL,
	`actor_agent_id` text,
	`payload` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`restricted_to` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_events_match_seq_idx` ON `game_events` (`match_id`,`seq`);--> statement-breakpoint
CREATE TABLE `match_participants` (
	`match_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`seat_index` integer NOT NULL,
	`initial_data` text,
	PRIMARY KEY(`match_id`, `agent_id`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_participants_match_idx` ON `match_participants` (`match_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`game_type` text NOT NULL,
	`status` text NOT NULL,
	`config` text NOT NULL,
	`started_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`completed_at` integer,
	`winner_faction` text,
	`final_ranking` text,
	`stats` text
);
--> statement-breakpoint
CREATE TABLE `semantic_memory` (
	`observer_agent_id` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`game_type` text NOT NULL,
	`profile_json` text NOT NULL,
	`games_observed` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	PRIMARY KEY(`observer_agent_id`, `target_agent_id`, `game_type`)
);
--> statement-breakpoint
CREATE TABLE `working_memory` (
	`observer_agent_id` text NOT NULL,
	`match_id` text NOT NULL,
	`game_type` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	PRIMARY KEY(`observer_agent_id`, `match_id`)
);
