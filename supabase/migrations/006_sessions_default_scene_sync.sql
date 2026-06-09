-- Migration 006: sync weather + bg-visibility on default scene
-- When no overlay scene is active (active_scene_id = null), the DM can still
-- toggle the background and set weather. These states need to reach remote players
-- via Realtime. We store them on the sessions row so a single UPDATE fires the event.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS current_weather_preset_id UUID REFERENCES weather_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_bg_visible BOOLEAN NOT NULL DEFAULT TRUE;
