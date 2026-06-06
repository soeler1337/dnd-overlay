-- DnD Overlay - Initial Schema
-- Run this ONCE in the Supabase SQL Editor of your project.
-- Milestone 2 adds RLS policies; this file creates the tables only.

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- campaigns
-- -------------------------------------------------------------------------
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  dm_user_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- scenes  (each campaign has a list of named scenes)
-- -------------------------------------------------------------------------
create table if not exists scenes (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  name              text not null,
  background_url    text,           -- Supabase Storage public URL
  music_track_url   text,           -- Supabase Storage public URL
  is_combat         boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- sessions  (one active session per campaign; holds the current scene)
-- -------------------------------------------------------------------------
create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references campaigns(id) on delete cascade,
  active_scene_id  uuid references scenes(id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- initiative
-- -------------------------------------------------------------------------
create table if not exists initiative (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  name        text not null,
  value       integer not null default 0,
  is_active   boolean not null default false,
  sort_order  integer not null default 0
);

-- -------------------------------------------------------------------------
-- handouts
-- -------------------------------------------------------------------------
create table if not exists handouts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  title        text not null,
  file_url     text not null,  -- Supabase Storage public URL
  type         text not null default 'image',  -- 'image' | 'pdf' (future)
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- handout_shares  (controls visibility per player)
-- -------------------------------------------------------------------------
create table if not exists handout_shares (
  id               uuid primary key default gen_random_uuid(),
  handout_id       uuid not null references handouts(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete cascade,  -- null = see shared_with_all
  shared_with_all  boolean not null default false,
  created_at       timestamptz not null default now(),
  -- either targeting a specific user OR shared with all
  constraint handout_shares_target_check check (
    (user_id is not null and shared_with_all = false)
    or
    (user_id is null and shared_with_all = true)
  )
);

-- -------------------------------------------------------------------------
-- profiles  (one row per user - extended by trigger on auth.users insert)
-- -------------------------------------------------------------------------
create table if not exists profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  role          text not null default 'player',  -- 'dm' | 'player'
  campaign_id   uuid references campaigns(id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint profiles_role_check check (role in ('dm', 'player'))
);

-- Auto-create a profile row when a new user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (user_id, display_name)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- -------------------------------------------------------------------------
-- Realtime: enable for tables clients need to subscribe to
-- -------------------------------------------------------------------------
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table scenes;
alter publication supabase_realtime add table initiative;
alter publication supabase_realtime add table handout_shares;
