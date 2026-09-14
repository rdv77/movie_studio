CREATE TABLE `asset_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`upload_id` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_uploads_owner_created` ON `asset_uploads` (`owner`,`created`);