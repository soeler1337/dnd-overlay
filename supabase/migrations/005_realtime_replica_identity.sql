-- Migration 005: Fix Supabase Realtime with RLS
-- PROBLEM: When RLS is enabled on a table, Supabase Realtime needs REPLICA IDENTITY FULL
-- to verify that the subscribing user has SELECT permission on the changed row.
-- Without it, Realtime shows "SUBSCRIBED" but silently drops ALL events.
--
-- Also: campaign_notes was missing from the supabase_realtime publication entirely.

-- Required for Realtime + RLS to work: Supabase needs the full old-row data
-- in the WAL replication stream to evaluate RLS policies on Realtime events.
ALTER TABLE sessions        REPLICA IDENTITY FULL;
ALTER TABLE scenes          REPLICA IDENTITY FULL;
ALTER TABLE campaign_notes  REPLICA IDENTITY FULL;

-- campaign_notes was not in the realtime publication – add it now
ALTER PUBLICATION supabase_realtime ADD TABLE campaign_notes;
