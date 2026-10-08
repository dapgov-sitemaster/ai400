import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const applications = pgTable("applications", {
  owner: uuid("owner").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("draft"),
  enrollmentStatus: text("enrollment_status")
    .$type<"not_enrolled" | "enrolled">()
    .notNull()
    .default("not_enrolled"),
  reference: text("reference").unique(),
  submitted: timestamp("submitted", { withTimezone: true }),
  updated: timestamp("updated", { withTimezone: true }).notNull(),
});

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey(),
    owner: uuid("owner").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    storageKey: uuid("storage_key").notNull().unique(),
    type: text("type").notNull(),
  },
  (table) => [
    uniqueIndex("idx_uploads_owner_kind").on(table.owner, table.kind),
    index("idx_uploads_owner").on(table.owner),
  ],
);
