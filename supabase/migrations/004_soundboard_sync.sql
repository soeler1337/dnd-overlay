-- Migration 004: soundboard sync for remote players
-- Adds last_sfx_url + last_sfx_at to sessions so remote players
-- receive soundboard events via Supabase Realtime (postgres_changes).
-- Run this in the Supabase SQL editor after 001, 002, 003.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_sfx_url TEXT,
  ADD COLUMN IF NOT EXISTS last_sfx_at  TIMESTAMPTZ;
