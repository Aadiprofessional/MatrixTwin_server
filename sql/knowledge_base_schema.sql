-- Knowledge Base Schema
-- Supabase + Qwen3-Embedding-8B (4096 dimensions)

-- ─────────────────────────────────────────────────────────────
-- 1. Extensions
-- ─────────────────────────────────────────────────────────────

create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- 2. dwss_files
-- ─────────────────────────────────────────────────────────────

create table if not exists public.dwss_files (
    id uuid primary key default uuid_generate_v4(),

    original_name text not null,
    file_type text not null,
    processing_mode text not null,

    status text not null default 'processing',
    total_chunks integer default 0,

    metadata jsonb default '{}'::jsonb,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists dwss_files_status_idx
    on public.dwss_files(status);

create index if not exists dwss_files_created_idx
    on public.dwss_files(created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3. dwss_chunks
-- Qwen3-Embedding-8B = 4096 dimensions
-- ─────────────────────────────────────────────────────────────

create table if not exists public.dwss_chunks (
    id uuid primary key default uuid_generate_v4(),

    content text not null,

    embedding vector(4096) not null,

    metadata jsonb default '{}'::jsonb,

    created_at timestamptz default now()
);

create index if not exists dwss_chunks_metadata_idx
    on public.dwss_chunks using gin (metadata);

-- IMPORTANT:
-- HNSW does NOT support 4096-dimensional vectors.
-- Do NOT create an HNSW index for this model.

-- ─────────────────────────────────────────────────────────────
-- 4. Disable RLS
-- ─────────────────────────────────────────────────────────────

alter table public.dwss_files disable row level security;
alter table public.dwss_chunks disable row level security;

-- ─────────────────────────────────────────────────────────────
-- 5. Permissions
-- ─────────────────────────────────────────────────────────────

grant all on table public.dwss_files to anon, authenticated, service_role;
grant all on table public.dwss_chunks to anon, authenticated, service_role;
