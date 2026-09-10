/**
 * SQLite schema for local development. Production Postgres schema lands in a
 * later phase; JSONB and UUID are represented as typed text in SQLite.
 */
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    gameType: text('game_type').notNull(),
    kind: text('kind').notNull().default('player'),
    profileId: text('profile_id')
      .notNull()
      .references(() => apiProfiles.id),
    systemPrompt: text('system_prompt').notNull(),
    avatarEmoji: text('avatar_emoji'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [index('agents_game_type_kind_idx').on(table.gameType, table.kind)],
)

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  gameType: text('game_type').notNull(),
  status: text('status').notNull(),
  config: text('config', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  winnerFaction: text('winner_faction'),
  finalRanking: text('final_ranking', { mode: 'json' }).$type<Record<string, unknown>>(),
  stats: text('stats', { mode: 'json' }).$type<Record<string, unknown>>(),
})

export const matchParticipants = sqliteTable(
  'match_participants',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    seatIndex: integer('seat_index').notNull(),
    initialData: text('initial_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.agentId] }),
    index('match_participants_match_idx').on(table.matchId),
  ],
)

export const gameEvents = sqliteTable(
  'game_events',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    seq: integer('seq').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
    kind: text('kind').notNull(),
    actorAgentId: text('actor_agent_id'),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    visibility: text('visibility').notNull().default('public'),
    restrictedTo: text('restricted_to', { mode: 'json' }).$type<string[] | null>(),
  },
  (table) => [index('game_events_match_seq_idx').on(table.matchId, table.seq)],
)

/**
 * LLM 用量流水（FR-4.8-03 / NFR-06，R3-6）。
 *
 * 每次真实的 LLM 调用一行（决策 / 主持 / 解说 / 配置测试）。match_id 与
 * agent_id 可空：非对局调用（如 profile 连通性测试）没有归属对局。不设
 * 外键——用量是审计流水，主体被清理后仍保留计数。
 */
export const llmUsage = sqliteTable(
  'llm_usage',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id'),
    agentId: text('agent_id'),
    profileId: text('profile_id'),
    purpose: text('purpose').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    model: text('model'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [
    index('llm_usage_match_idx').on(table.matchId),
    index('llm_usage_agent_idx').on(table.agentId),
    index('llm_usage_purpose_idx').on(table.purpose),
  ],
)

/**
 * FR-4.9-01 跨对局 ELO 天梯（按品类分列；composite PK = agent + gameType）。
 * 无外键审计流水口径与 llm_usage 一致——agents 删除时 ratings 留存。
 */
export const eloRatings = sqliteTable(
  'elo_ratings',
  {
    agentId: text('agent_id').notNull(),
    gameType: text('game_type').notNull(),
    rating: integer('rating').notNull().default(1000),
    matchesPlayed: integer('matches_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    /** 最近一次评分变动（正负或 0），天梯趋势展示用。 */
    lastDelta: integer('last_delta').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.gameType] }),
    index('elo_ratings_game_idx').on(table.gameType),
  ],
)

export const agentErrors = sqliteTable('agent_errors', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  agentId: text('agent_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
  layer: text('layer').notNull(),
  errorCode: text('error_code').notNull(),
  rawResponse: text('raw_response'),
  recoveryAction: text('recovery_action', { mode: 'json' }).$type<Record<string, unknown>>(),
})

export const workingMemory = sqliteTable(
  'working_memory',
  {
    observerAgentId: text('observer_agent_id').notNull(),
    matchId: text('match_id').notNull(),
    gameType: text('game_type').notNull(),
    stateJson: text('state_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [primaryKey({ columns: [table.observerAgentId, table.matchId] })],
)

export const episodicMemory = sqliteTable(
  'episodic_memory',
  {
    id: text('id').primaryKey(),
    observerAgentId: text('observer_agent_id').notNull(),
    targetAgentId: text('target_agent_id'),
    matchId: text('match_id').notNull(),
    gameType: text('game_type').notNull(),
    entryJson: text('entry_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [
    index('episodic_obs_target_idx').on(
      table.observerAgentId,
      table.targetAgentId,
      table.gameType,
      table.createdAt,
    ),
    index('episodic_obs_gametype_idx').on(table.observerAgentId, table.gameType, table.createdAt),
  ],
)

export const semanticMemory = sqliteTable(
  'semantic_memory',
  {
    observerAgentId: text('observer_agent_id').notNull(),
    targetAgentId: text('target_agent_id').notNull(),
    gameType: text('game_type').notNull(),
    profileJson: text('profile_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    gamesObserved: integer('games_observed').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (table) => [
    primaryKey({
      columns: [table.observerAgentId, table.targetAgentId, table.gameType],
    }),
  ],
)
