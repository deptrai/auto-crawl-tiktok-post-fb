import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

test('[P0] DB schema defines proxy_configs metadata table without api key column', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/db/client.ts'), 'utf8')
  const match = source.match(/CREATE TABLE IF NOT EXISTS proxy_configs\([\s\S]*?\)/)

  expect(match?.[0]).toContain('provider TEXT PRIMARY KEY')
  expect(match?.[0]).toContain('enabled INTEGER NOT NULL DEFAULT 1')
  expect(match?.[0]).toContain('last_rotated_at TEXT')
  expect(match?.[0]).not.toMatch(/api[_-]?key|proxy\.proxyfb\.api_key/i)
})

test('[P0] DB schema defines automation_jobs table for persisted job state', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/db/client.ts'), 'utf8')
  const match = source.match(/CREATE TABLE IF NOT EXISTS automation_jobs\([\s\S]*?result TEXT\s*\)/)

  expect(match?.[0]).toContain('id TEXT PRIMARY KEY')
  expect(match?.[0]).toContain('profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE')
  expect(match?.[0]).toContain('type TEXT NOT NULL')
  expect(match?.[0]).toContain('state TEXT NOT NULL')
  expect(match?.[0]).toContain('started_at TEXT NOT NULL')
  expect(match?.[0]).toContain('completed_at TEXT')
  expect(match?.[0]).toContain('result TEXT')
})
