CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bookmark` (
	`user_id` text NOT NULL,
	`column_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `column_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `column`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `check_run` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`revision_id` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`conclusion` text DEFAULT 'empty' NOT NULL,
	`n_verified` integer DEFAULT 0 NOT NULL,
	`n_drifted` integer DEFAULT 0 NOT NULL,
	`n_broken` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `column`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `revision`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `check_run_column_idx` ON `check_run` (`column_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `claim_result` (
	`id` text PRIMARY KEY NOT NULL,
	`check_run_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`verdict` text NOT NULL,
	`observed_value` real,
	`observed_unit` text,
	`delta_pct` real,
	`dataset_release` text,
	`dataset_version` integer,
	`note` text,
	`evidence` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`check_run_id`) REFERENCES `check_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claim`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_result_run_idx` ON `claim_result` (`check_run_id`);--> statement-breakpoint
CREATE TABLE `claim` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`key` text NOT NULL,
	`dataset_slug` text NOT NULL,
	`query` text,
	`source` text DEFAULT '' NOT NULL,
	`expected_value` real,
	`expected_unit` text,
	`tolerance_pct` real DEFAULT 10 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `column`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_key_idx` ON `claim` (`column_id`,`key`);--> statement-breakpoint
CREATE TABLE `column` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`excerpt` text,
	`body` text DEFAULT '' NOT NULL,
	`author_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`access` text DEFAULT 'public' NOT NULL,
	`forked_from_id` text,
	`repo_url` text,
	`repo_commit` text,
	`reading_minutes` integer,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `column_slug_unique` ON `column` (`slug`);--> statement-breakpoint
CREATE INDEX `column_author_idx` ON `column` (`author_id`);--> statement-breakpoint
CREATE INDEX `column_feed_idx` ON `column` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `dataset` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`release` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`generated_at` integer,
	`provenance` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_slug_unique` ON `dataset` (`slug`);--> statement-breakpoint
CREATE TABLE `fact` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`subject` text NOT NULL,
	`object` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`unit` text,
	`n_points` integer,
	`n_docs` integer,
	`scope` text DEFAULT 'all' NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `dataset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fact_cell_idx` ON `fact` (`dataset_id`,`subject`,`object`,`metric`,`scope`);--> statement-breakpoint
CREATE INDEX `fact_lookup_idx` ON `fact` (`dataset_id`,`metric`);--> statement-breakpoint
CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`base_revision_id` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`resolved_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `column`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_revision_id`) REFERENCES `revision`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `proposal_column_idx` ON `proposal` (`column_id`,`status`);--> statement-breakpoint
CREATE TABLE `revision` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`message` text DEFAULT 'Update' NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `column`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_number_idx` ON `revision` (`column_id`,`number`);--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stripe_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`error` text,
	`payload` text
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`plan` text NOT NULL,
	`interval` text DEFAULT 'month' NOT NULL,
	`status` text NOT NULL,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`canceled_at` integer,
	`trial_end` integer,
	`payment_failed_at` integer,
	`latest_invoice_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_stripe_subscription_id_unique` ON `subscription` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscription_user_idx` ON `subscription` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text,
	`handle` text,
	`bio` text,
	`password_hash` text,
	`role` text DEFAULT 'reader' NOT NULL,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_handle_unique` ON `user` (`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_stripe_customer_id_unique` ON `user` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
