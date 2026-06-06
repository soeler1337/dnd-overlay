-- Milestone 2: Row Level Security policies.
-- Run this in the Supabase SQL Editor AFTER 001_initial_schema.sql.

-- Enable RLS on all tables
alter table campaigns      enable row level security;
alter table scenes         enable row level security;
alter table sessions       enable row level security;
alter table initiative     enable row level security;
alter table handouts       enable row level security;
alter table handout_shares enable row level security;
alter table profiles       enable row level security;

-- -------------------------------------------------------------------------
-- profiles: everyone can read their own row; only the user can update it.
-- -------------------------------------------------------------------------
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = user_id);

create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- campaigns: DM full access; players can read campaigns they are in.
-- -------------------------------------------------------------------------
create policy "campaigns_dm_all"
  on campaigns for all
  using (auth.uid() = dm_user_id);

create policy "campaigns_player_read"
  on campaigns for select
  using (
    exists (
      select 1 from profiles
      where profiles.user_id     = auth.uid()
        and profiles.campaign_id = campaigns.id
    )
  );

-- -------------------------------------------------------------------------
-- scenes: same visibility rules as campaigns.
-- -------------------------------------------------------------------------
create policy "scenes_dm_all"
  on scenes for all
  using (
    exists (
      select 1 from campaigns
      where campaigns.id = scenes.campaign_id
        and campaigns.dm_user_id = auth.uid()
    )
  );

create policy "scenes_player_read"
  on scenes for select
  using (
    exists (
      select 1 from profiles
      where profiles.user_id     = auth.uid()
        and profiles.campaign_id = scenes.campaign_id
    )
  );

-- -------------------------------------------------------------------------
-- sessions: DM can write; everyone in the campaign can read.
-- -------------------------------------------------------------------------
create policy "sessions_dm_write"
  on sessions for all
  using (
    exists (
      select 1 from campaigns
      where campaigns.id = sessions.campaign_id
        and campaigns.dm_user_id = auth.uid()
    )
  );

create policy "sessions_player_read"
  on sessions for select
  using (
    exists (
      select 1 from profiles
      where profiles.user_id     = auth.uid()
        and profiles.campaign_id = sessions.campaign_id
    )
  );

-- -------------------------------------------------------------------------
-- initiative: DM writes; everyone in the campaign reads.
-- -------------------------------------------------------------------------
create policy "initiative_dm_write"
  on initiative for all
  using (
    exists (
      select 1 from sessions
        join campaigns on campaigns.id = sessions.campaign_id
      where sessions.id = initiative.session_id
        and campaigns.dm_user_id = auth.uid()
    )
  );

create policy "initiative_player_read"
  on initiative for select
  using (
    exists (
      select 1 from sessions
        join profiles on profiles.campaign_id = sessions.campaign_id
      where sessions.id = initiative.session_id
        and profiles.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------------
-- handouts: DM writes; players read their own or shared_with_all.
-- -------------------------------------------------------------------------
create policy "handouts_dm_all"
  on handouts for all
  using (
    exists (
      select 1 from campaigns
      where campaigns.id = handouts.campaign_id
        and campaigns.dm_user_id = auth.uid()
    )
  );

create policy "handouts_player_read"
  on handouts for select
  using (
    exists (
      select 1 from handout_shares
      where handout_shares.handout_id = handouts.id
        and (
          handout_shares.shared_with_all = true
          or handout_shares.user_id = auth.uid()
        )
    )
  );

-- -------------------------------------------------------------------------
-- handout_shares: DM writes; players read shares that target them or all.
-- -------------------------------------------------------------------------
create policy "handout_shares_dm_all"
  on handout_shares for all
  using (
    exists (
      select 1 from handouts
        join campaigns on campaigns.id = handouts.campaign_id
      where handouts.id = handout_shares.handout_id
        and campaigns.dm_user_id = auth.uid()
    )
  );

create policy "handout_shares_player_read"
  on handout_shares for select
  using (
    shared_with_all = true
    or user_id = auth.uid()
  );
