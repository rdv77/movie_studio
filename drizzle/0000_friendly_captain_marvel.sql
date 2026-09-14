CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_owner` ON `assets` (`owner`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`cipher` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated` ON `projects` (`owner`,`updated`);