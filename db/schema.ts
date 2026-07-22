import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const graphViews = sqliteTable(
  "graph_views",
  {
    id: text("id").primaryKey(),
    graphId: text("graph_id")
      .notNull()
      .references(() => graphs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    positionsJson: text("positions_json").notNull().default("{}"),
    focusRootId: text("focus_root_id"),
    collapsedNodeIdsJson: text("collapsed_node_ids_json").notNull().default("[]"),
    pinnedNodeIdsJson: text("pinned_node_ids_json").notNull().default("[]"),
    viewportJson: text("viewport_json").notNull().default('{"x":360,"y":300,"zoom":1}'),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("graph_views_graph_updated_idx").on(table.graphId, table.updatedAt),
    uniqueIndex("graph_views_graph_name_unique").on(table.graphId, table.name),
    uniqueIndex("graph_views_one_primary_per_graph")
      .on(table.graphId)
      .where(sql`${table.isPrimary} = 1`),
  ],
);
