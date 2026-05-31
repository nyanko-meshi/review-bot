-- Supabase で実行するSQL（Table Editor > SQL Editor）

create table users (
  id uuid default gen_random_uuid() primary key,
  line_user_id text unique not null,
  created_at timestamptz default now()
);

create table watched_stores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  place_id text not null,
  place_name text not null,
  maps_url text not null,
  created_at timestamptz default now(),
  unique(user_id, place_id)
);

create table notified_reviews (
  id uuid default gen_random_uuid() primary key,
  place_id text not null,
  review_hash text not null,
  created_at timestamptz default now(),
  unique(place_id, review_hash)
);

create table conversation_states (
  line_user_id text primary key,
  state text not null default 'idle',
  data jsonb,
  updated_at timestamptz default now()
);
