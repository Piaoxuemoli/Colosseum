CREATE TABLE `llm_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text,
	`agent_id` text,
	`profile_id` text,
	`purpose` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`model` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_usage_match_idx` ON `llm_usage` (`match_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_agent_idx` ON `llm_usage` (`agent_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_purpose_idx` ON `llm_usage` (`purpose`);