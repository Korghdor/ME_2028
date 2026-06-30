-- BalticWood ME 2028 - schemat testowy Supabase
-- Uruchom ten plik w Supabase: SQL Editor -> New query -> Run.
-- Skrypt tworzy tylko obiekty z prefiksem me2028_.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.me2028_players (
  id uuid primary key default gen_random_uuid(),
  login text unique,
  name text not null unique,
  pin_hash text not null,
  is_master boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.me2028_players
  add column if not exists login text;

create unique index if not exists me2028_players_login_unique
  on public.me2028_players (lower(login))
  where login is not null;

create table if not exists public.me2028_matches (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  result_home integer,
  result_away integer,
  completed boolean not null default false,
  result_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint me2028_result_home_nonnegative check (result_home is null or result_home >= 0),
  constraint me2028_result_away_nonnegative check (result_away is null or result_away >= 0)
);

create table if not exists public.me2028_predictions (
  player_id uuid not null references public.me2028_players(id) on delete cascade,
  match_id uuid not null references public.me2028_matches(id) on delete cascade,
  home_goals integer not null,
  away_goals integer not null,
  saved_at timestamptz not null default now(),
  primary key (player_id, match_id),
  constraint me2028_prediction_home_nonnegative check (home_goals >= 0),
  constraint me2028_prediction_away_nonnegative check (away_goals >= 0)
);

create table if not exists public.me2028_sessions (
  token uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.me2028_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.me2028_players enable row level security;
alter table public.me2028_matches enable row level security;
alter table public.me2028_predictions enable row level security;
alter table public.me2028_sessions enable row level security;

revoke all on table public.me2028_players from anon, authenticated;
revoke all on table public.me2028_matches from anon, authenticated;
revoke all on table public.me2028_predictions from anon, authenticated;
revoke all on table public.me2028_sessions from anon, authenticated;

delete from public.me2028_players
where login in ('maciej', 'tomasz')
  or name like 'Maciej Zaj%'
  or name like 'Tomasz Broc%';

insert into public.me2028_players (login, name, pin_hash, is_master)
values
  ('maciej', 'Maciej Zając', extensions.crypt('8500', extensions.gen_salt('bf')), true),
  ('tomasz', 'Tomasz Brocławik', extensions.crypt('1257', extensions.gen_salt('bf')), false);

insert into public.me2028_matches (number, home_team, away_team, kickoff_at)
values
  (1, 'Polska', 'Szkocja', now() + interval '8 minutes'),
  (2, 'Hiszpania', 'Dania', now() + interval '35 minutes'),
  (3, 'Włochy', 'Holandia', now() + interval '3 hours'),
  (4, 'Portugalia', 'Czechy', now() + interval '1 day')
on conflict (number) do update
set
  home_team = excluded.home_team,
  away_team = excluded.away_team,
  kickoff_at = excluded.kickoff_at,
  result_home = null,
  result_away = null,
  completed = false,
  result_updated_at = null;

create or replace function public.me2028_session_player(p_session_token uuid)
returns public.me2028_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
begin
  delete from public.me2028_sessions where expires_at < now();

  select p.*
    into v_player
  from public.me2028_sessions s
  join public.me2028_players p on p.id = s.player_id
  where s.token = p_session_token
    and s.expires_at > now()
    and p.active = true;

  if not found then
    raise exception 'Sesja wygasła albo jest nieprawidłowa.' using errcode = '28000';
  end if;

  return v_player;
end;
$$;

create or replace function public.me2028_ranking_json()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with score_rows as (
    select
      p.id,
      p.name,
      coalesce(sum(
        case
          when m.completed
            and pr.home_goals = m.result_home
            and pr.away_goals = m.result_away
            then 3
          when m.completed
            and sign(pr.home_goals - pr.away_goals) = sign(m.result_home - m.result_away)
            then 1
          else 0
        end
      ), 0)::integer as points,
      coalesce(sum(
        case
          when m.completed
            and pr.home_goals = m.result_home
            and pr.away_goals = m.result_away
            then 1
          else 0
        end
      ), 0)::integer as exact,
      coalesce(sum(
        case
          when m.completed
            and not (pr.home_goals = m.result_home and pr.away_goals = m.result_away)
            and sign(pr.home_goals - pr.away_goals) = sign(m.result_home - m.result_away)
            then 1
          else 0
        end
      ), 0)::integer as outcome
    from public.me2028_players p
    left join public.me2028_predictions pr on pr.player_id = p.id
    left join public.me2028_matches m on m.id = pr.match_id
    where p.active = true
    group by p.id, p.name
  ),
  ranked as (
    select
      *,
      dense_rank() over (order by points desc) as rank
    from score_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'playerId', id,
        'name', name,
        'rank', rank,
        'points', points,
        'exact', exact,
        'outcome', outcome
      )
      order by rank, name
    ),
    '[]'::jsonb
  )
  from ranked;
$$;

create or replace function public.me2028_bootstrap_json(p_player public.me2028_players)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'player', jsonb_build_object(
      'id', p_player.id,
      'name', p_player.name,
      'isMaster', p_player.is_master
    ),
    'matches', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'number', number,
            'home', home_team,
            'away', away_team,
            'kickoff', kickoff_at,
            'resultHome', result_home,
            'resultAway', result_away,
            'completed', completed
          )
          order by number
        ),
        '[]'::jsonb
      )
      from public.me2028_matches
    ),
    'predictions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'matchId', match_id,
            'home', home_goals,
            'away', away_goals,
            'savedAt', saved_at
          )
        ),
        '[]'::jsonb
      )
      from public.me2028_predictions
      where player_id = p_player.id
    ),
    'ranking', public.me2028_ranking_json(),
    'lastCalculatedAt', (
      select max(result_updated_at)
      from public.me2028_matches
      where completed = true
    )
  );
$$;

create or replace function public.me2028_login(p_player_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
  v_token uuid;
begin
  select *
    into v_player
  from public.me2028_players
  where (
      lower(login) = lower(trim(p_player_name))
      or lower(name) = lower(trim(p_player_name))
    )
    and active = true
    and pin_hash = extensions.crypt(p_pin, pin_hash);

  if v_player.id is null then
    raise exception 'Nieprawidłowy zawodnik albo PIN.' using errcode = '28000';
  end if;

  delete from public.me2028_sessions where expires_at < now();

  insert into public.me2028_sessions (player_id, expires_at)
  values (v_player.id, now() + interval '30 days')
  returning token into v_token;

  return jsonb_build_object(
    'token', v_token,
    'data', public.me2028_bootstrap_json(v_player)
  );
end;
$$;

create or replace function public.me2028_get_bootstrap(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
begin
  v_player := public.me2028_session_player(p_session_token);
  return public.me2028_bootstrap_json(v_player);
end;
$$;

create or replace function public.me2028_save_prediction(
  p_session_token uuid,
  p_match_id uuid,
  p_home_goals integer,
  p_away_goals integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
  v_match public.me2028_matches;
begin
  if p_home_goals is null or p_away_goals is null or p_home_goals < 0 or p_away_goals < 0 then
    raise exception 'Typ musi zawierać dwie liczby 0 lub większe.' using errcode = '22023';
  end if;

  v_player := public.me2028_session_player(p_session_token);

  select *
    into v_match
  from public.me2028_matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Nie znaleziono meczu.' using errcode = '22023';
  end if;

  if v_match.completed then
    raise exception 'Ten mecz ma już zapisany wynik.' using errcode = '22023';
  end if;

  if now() >= v_match.kickoff_at - interval '10 minutes' then
    raise exception 'Typowanie tego meczu jest już zamknięte.' using errcode = '22023';
  end if;

  insert into public.me2028_predictions (player_id, match_id, home_goals, away_goals, saved_at)
  values (v_player.id, p_match_id, p_home_goals, p_away_goals, now())
  on conflict (player_id, match_id) do update
  set
    home_goals = excluded.home_goals,
    away_goals = excluded.away_goals,
    saved_at = excluded.saved_at;

  return public.me2028_bootstrap_json(v_player);
end;
$$;

create or replace function public.me2028_save_match_result(
  p_session_token uuid,
  p_match_id uuid,
  p_home_goals integer,
  p_away_goals integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
begin
  v_player := public.me2028_session_player(p_session_token);

  if not v_player.is_master then
    raise exception 'Brak uprawnień master.' using errcode = '42501';
  end if;

  if (p_home_goals is null and p_away_goals is not null)
    or (p_home_goals is not null and p_away_goals is null)
    or p_home_goals < 0
    or p_away_goals < 0 then
    raise exception 'Wynik musi być pusty albo zawierać dwie liczby 0 lub większe.' using errcode = '22023';
  end if;

  update public.me2028_matches
  set
    result_home = p_home_goals,
    result_away = p_away_goals,
    completed = p_home_goals is not null and p_away_goals is not null,
    result_updated_at = case
      when p_home_goals is not null and p_away_goals is not null then now()
      else null
    end
  where id = p_match_id;

  if not found then
    raise exception 'Nie znaleziono meczu.' using errcode = '22023';
  end if;

  return public.me2028_bootstrap_json(v_player);
end;
$$;

create or replace function public.me2028_reset_demo(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.me2028_players;
begin
  v_player := public.me2028_session_player(p_session_token);

  if not v_player.is_master then
    raise exception 'Brak uprawnień master.' using errcode = '42501';
  end if;

  delete from public.me2028_predictions
  where true;

  update public.me2028_matches
  set
    kickoff_at = case number
      when 1 then now() + interval '8 minutes'
      when 2 then now() + interval '35 minutes'
      when 3 then now() + interval '3 hours'
      else now() + interval '1 day'
    end,
    result_home = null,
    result_away = null,
    completed = false,
    result_updated_at = null
  where number in (1, 2, 3, 4);

  return public.me2028_bootstrap_json(v_player);
end;
$$;

revoke execute on function public.me2028_session_player(uuid) from public;
revoke execute on function public.me2028_ranking_json() from public;
revoke execute on function public.me2028_bootstrap_json(public.me2028_players) from public;

grant execute on function public.me2028_login(text, text) to anon, authenticated;
grant execute on function public.me2028_get_bootstrap(uuid) to anon, authenticated;
grant execute on function public.me2028_save_prediction(uuid, uuid, integer, integer) to anon, authenticated;
grant execute on function public.me2028_save_match_result(uuid, uuid, integer, integer) to anon, authenticated;
grant execute on function public.me2028_reset_demo(uuid) to anon, authenticated;
