-- Migration 003: default background image per campaign
-- Run this in the Supabase SQL editor after 001 and 002.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS default_background_url TEXT;
