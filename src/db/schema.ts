import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  due: text('due').notNull(),
  notified: integer('notified').notNull().default(0),
});

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  completed: integer('completed').notNull().default(0),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  summary: text('summary'),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => sessions.id),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  tokenCount: integer('token_count'),
}, (table) => ({
  sessionIdIdx: index('messages_session_id_idx').on(table.sessionId),
}));

