-- BeyondTheLabel — Supabase Schema
-- Paste this entire file into Supabase SQL Editor and click Run

-- ── EXTENSIONS ───────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for fuzzy text search

-- ── USERS ────────────────────────────────────────────────────────
create table users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- style profile
  pinterest_board_url text,
  pinterest_synced_at timestamptz,

  -- size profile (stored per region)
  size_eu text,        -- e.g. "38"
  size_uk text,        -- e.g. "10"
  size_us text,        -- e.g. "6"
  size_top text,       -- e.g. "S", "M"
  size_shoe_eu text,   -- e.g. "39"

  -- preferences
  budget_min integer default 0,
  budget_max integer default 2000,
  currency text default 'DKK',
  preferred_sources text[] default array['second-hand', 'verified-brands'],
  exclude_synthetics boolean default false,

  -- subscription
  plan text default 'free' check (plan in ('free', 'premium')),
  plan_expires_at timestamptz,

  -- 25-hour hold preference (opt-in)
  wishlist_hold_enabled boolean default false
);

-- ── BRANDS ───────────────────────────────────────────────────────
create table brands (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  name text not null,
  slug text unique not null,
  description text,
  website_url text,
  logo_url text,
  country text,
  city text,

  -- verification
  verified boolean default false,
  verification_status text default 'pending'
    check (verification_status in ('pending', 'under_review', 'verified', 'rejected', 'suspended')),
  verified_at timestamptz,
  verification_expires_at timestamptz,
  verification_tier text check (verification_tier in ('free', 'standard', 'premier')),
  annual_revenue_band text check (annual_revenue_band in ('under_2m', '2m_10m', '10m_50m', 'over_50m')),

  -- sustainability data
  certifications text[],         -- e.g. ['GOTS', 'OEKO-TEX', 'B Corp']
  primary_materials text[],      -- e.g. ['organic cotton', 'linen', 'recycled polyester']
  avoids_synthetics boolean,
  supply_chain_tier integer,     -- how many tiers visible (1 = manufacturers, 2 = fabric mills, etc.)
  sustainability_notes text,

  -- search
  search_vector tsvector
);

create index brands_search_idx on brands using gin(search_vector);
create index brands_verified_idx on brands(verified) where verified = true;

-- ── PRODUCTS ─────────────────────────────────────────────────────
create table products (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- source
  source text not null check (source in ('vinted', 'dba', 'sellply', 'brand_direct')),
  source_id text,               -- original ID on source platform
  source_url text,
  brand_id uuid references brands(id),

  -- product info
  title text not null,
  description text,
  price integer not null,       -- in øre (DKK cents) — always store as integer
  currency text default 'DKK',
  images text[],                -- array of image URLs

  -- sizing
  size_label text,              -- raw label from source e.g. "38", "M/L", "One size"
  size_eu text,
  size_uk text,
  size_us text,
  category text,                -- 'tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'

  -- sustainability
  sustainability_score integer check (sustainability_score between 0 and 100),
  fibre_data jsonb,             -- { cotton: 76, elastane: 24, origin: 'Portugal', certified: true }
  fibre_data_source text check (fibre_data_source in ('brand_provided', 'brand_lookup', 'unknown')),

  -- visual matching
  clip_embedding vector(512),   -- CLIP visual embedding for similarity search
  -- note: requires pgvector extension (available in Supabase)

  -- availability
  available boolean default true,
  last_seen_at timestamptz default now(),

  -- search
  search_vector tsvector
);

create index products_source_idx on products(source);
create index products_available_idx on products(available) where available = true;
create index products_category_idx on products(category);
create index products_price_idx on products(price);
create index products_score_idx on products(sustainability_score);
create index products_search_idx on products using gin(search_vector);

-- ── WARDROBE ─────────────────────────────────────────────────────
create table wardrobe_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade not null,
  created_at timestamptz default now(),

  -- item details
  name text not null,
  brand text,
  category text,
  color text,
  image_url text,
  purchase_price integer,       -- in øre
  purchase_date date,
  source text,                  -- where it was bought

  -- sustainability
  fibre_data jsonb,
  sustainability_score integer,

  -- cost per wear tracking
  times_worn integer default 0,
  last_worn_at date,

  -- re-listing
  listed_on_vinted boolean default false,
  vinted_listing_url text
);

create index wardrobe_user_idx on wardrobe_items(user_id);

-- ── WISHLIST (25-hour hold) ───────────────────────────────────────
create table wishlist_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  created_at timestamptz default now(),
  hold_until timestamptz,       -- null = permanent save, timestamp = 25-hour hold
  notified boolean default false, -- whether user has been reminded
  unique(user_id, product_id)
);

create index wishlist_user_idx on wishlist_items(user_id);
create index wishlist_hold_idx on wishlist_items(hold_until) where hold_until is not null;

-- ── BRAND APPLICATIONS ───────────────────────────────────────────
create table brand_applications (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  brand_name text not null,
  contact_email text not null,
  website_url text,
  annual_revenue_band text,
  sustainability_statement text,
  certifications_claimed text[],
  status text default 'received'
    check (status in ('received', 'under_review', 'approved', 'rejected', 'more_info_needed')),
  reviewer_notes text
);

-- ── SEARCH HISTORY (for improving recommendations) ───────────────
create table search_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  searched_at timestamptz default now(),
  query text,
  filters jsonb,
  results_count integer
);

-- ── FIBRE LOOKUP TABLE ───────────────────────────────────────────
-- Pre-populated with known brand product fibre data
-- Used to fill gaps in second-hand listings
create table fibre_lookup (
  id uuid primary key default uuid_generate_v4(),
  brand_name text not null,
  product_name_pattern text,    -- regex pattern to match product titles
  fibre_composition jsonb not null,
  source_url text,
  verified boolean default false,
  created_at timestamptz default now()
);

create index fibre_lookup_brand_idx on fibre_lookup(lower(brand_name));

-- ── FUNCTIONS ────────────────────────────────────────────────────

-- Auto-update search vectors
create or replace function update_product_search_vector()
returns trigger as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.title, '') || ' ' ||
    coalesce(new.description, '') || ' ' ||
    coalesce(new.category, '') || ' ' ||
    coalesce(new.size_label, '')
  );
  return new;
end;
$$ language plpgsql;

create trigger product_search_vector_update
  before insert or update on products
  for each row execute function update_product_search_vector();

create or replace function update_brand_search_vector()
returns trigger as $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.name, '') || ' ' ||
    coalesce(new.description, '') || ' ' ||
    coalesce(array_to_string(new.primary_materials, ' '), '') || ' ' ||
    coalesce(array_to_string(new.certifications, ' '), '')
  );
  return new;
end;
$$ language plpgsql;

create trigger brand_search_vector_update
  before insert or update on brands
  for each row execute function update_brand_search_vector();

-- Cost per wear calculation
create or replace function cost_per_wear(item_id uuid)
returns numeric as $$
  select
    case
      when times_worn = 0 then purchase_price::numeric
      else (purchase_price::numeric / times_worn)
    end
  from wardrobe_items
  where id = item_id;
$$ language sql;

-- Auto-expire 25-hour holds
create or replace function expire_holds()
returns void as $$
  update wishlist_items
  set hold_until = null
  where hold_until < now() and hold_until is not null;
$$ language sql;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────
-- Users can only see their own data
alter table users enable row level security;
alter table wardrobe_items enable row level security;
alter table wishlist_items enable row level security;
alter table search_history enable row level security;

create policy "Users own their profile"
  on users for all using (auth.uid() = id);

create policy "Users own their wardrobe"
  on wardrobe_items for all using (auth.uid() = user_id);

create policy "Users own their wishlist"
  on wishlist_items for all using (auth.uid() = user_id);

create policy "Users own their search history"
  on search_history for all using (auth.uid() = user_id);

-- Products and brands are public read
create policy "Products are public"
  on products for select using (true);

create policy "Brands are public"
  on brands for select using (true);

-- ── SEED DATA — initial verified brands ──────────────────────────
insert into brands (name, slug, description, country, city, verified, verification_status, verification_tier, annual_revenue_band, certifications, primary_materials, avoids_synthetics, supply_chain_tier) values
('Nudie Jeans', 'nudie-jeans', 'Swedish denim brand committed to organic cotton and full supply chain transparency.', 'Sweden', 'Gothenburg', true, 'verified', 'standard', '10m_50m', array['GOTS', 'Fair Trade'], array['organic cotton'], true, 2),
('Filippa K', 'filippa-k', 'Scandinavian fashion brand focused on timeless quality and responsible production.', 'Sweden', 'Stockholm', true, 'verified', 'standard', '10m_50m', array['OEKO-TEX'], array['organic cotton', 'linen', 'wool'], false, 2),
('Samsøe Samsøe', 'samsoe-samsoe', 'Danish brand using responsible materials and certified production.', 'Denmark', 'Copenhagen', true, 'verified', 'standard', '10m_50m', array['OEKO-TEX'], array['organic cotton', 'recycled polyester', 'linen'], false, 1),
('Aiayu', 'aiayu', 'Danish luxury brand using natural fibres with full traceability to source.', 'Denmark', 'Copenhagen', true, 'verified', 'premier', '2m_10m', array['GOTS', 'RWS'], array['alpaca', 'cashmere', 'organic cotton'], true, 3),
('Norse Projects', 'norse-projects', 'Copenhagen-based brand with a focus on natural materials and functional design.', 'Denmark', 'Copenhagen', true, 'verified', 'standard', '10m_50m', array['OEKO-TEX'], array['wool', 'cotton', 'nylon'], false, 1);
