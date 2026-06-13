CREATE TABLE `api_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`provider_id` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`temperature` integer DEFAULT 70 NOT NULL,
	`max_tokens` integer,
	`context_window_tokens` integer,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
