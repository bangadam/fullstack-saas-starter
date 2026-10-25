ALTER TABLE `files` ADD COLUMN `status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `files` ADD COLUMN `upload_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `files` ADD COLUMN `expires_at` integer;
--> statement-breakpoint
ALTER TABLE `files` ADD COLUMN `completed_at` integer;
--> statement-breakpoint
-- Legacy metadata predates upload completion tracking; preserve existing access.
UPDATE `files` SET `status` = 'completed', `completed_at` = `created_at`;
--> statement-breakpoint
CREATE INDEX `files_lifecycle_idx` ON `files` (`status`, `expires_at`);
