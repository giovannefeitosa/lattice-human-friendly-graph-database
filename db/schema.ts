import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const graphs = sqliteTable(
  "graphs",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    graphJson: text("graph_json").notNull(),
    graphHash: text("graph_hash").notNull(),
    thumbnailKey: text("thumbnail_key").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("graphs_owner_updated_idx").on(table.ownerEmail, table.updatedAt)],
);
