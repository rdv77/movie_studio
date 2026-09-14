// Add Drizzle tables here when the site needs a database.
import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
export const projects = sqliteTable(
  'projects',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    title: text().notNull(),
    state: text().notNull(),
    revision: integer().notNull().default(0),
    updated: text().notNull(),
  },
  (t) => [index('projects_owner_updated').on(t.owner, t.updated)],
);
export const assets = sqliteTable(
  'assets',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    name: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    created: text().notNull(),
  },
  (t) => [index('assets_owner').on(t.owner)],
);
export const credentials = sqliteTable(
  'credentials',
  {
    owner: text().notNull(),
    provider: text().notNull(),
    cipher: text().notNull(),
    updated: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.provider] })],
);
export const assetUploads = sqliteTable(
  'asset_uploads',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    name: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    upload_id: text().notNull(),
    created: text().notNull(),
  },
  (t) => [index('asset_uploads_owner_created').on(t.owner, t.created)],
);
