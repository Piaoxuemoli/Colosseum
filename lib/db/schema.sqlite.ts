import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Phase 0 仅实现 api_profiles 占位，用于验证连接。
// Phase 1 会按照 spec 第 8.1/8.2 节补齐所有表。
export const apiProfiles = sqliteTable('api_profiles', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  providerId: text('provider_id').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  temperature: integer('temperature').notNull().default(70),
  maxTokens: integer('max_tokens'),
  contextWindowTokens: integer('context_window_tokens'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
})
