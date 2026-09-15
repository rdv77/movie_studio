ALTER TABLE `asset_uploads` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `assets_owner_project` ON `assets` (`owner`,`project_id`);