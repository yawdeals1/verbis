-- Verbis schema. See PRODUCT_PLAN.md §4 for the source-of-truth data model.
-- Applied via the Deploro CLI (no direct Postgres connection from the app):
--   deploro migrate create init --up-file backend/src/db/schema.sql
--   deploro migrate apply init

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- App-level identity/authorization, layered on top of Deploro
-- Auth-as-a-Service (which handles the actual sign-in — see
-- backend/src/lib/deploroAuth.ts). A row here is the only thing that grants
-- Verbis access: Deploro can authenticate a stranger's raw signup, but
-- without a matching row here (created only by an admin invite,
-- routes/admin.ts) every Verbis route 403s them regardless. deploro_user_id
-- is nullable because it's only known once the invitee actually completes
-- signup and logs in for the first time (backfilled in routes/auth.ts).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deploro_user_id TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'contributor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_voice_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- BCP-47 locale (e.g. "en-US"), used to rank American/British voices
  -- first in the picker (see regionRank in services/ttsTypes.ts). Added by
  -- migrations/add_voice_locale_and_preview.sql.
  locale TEXT,
  -- A short hosted sample clip so a voice can be heard before any text is
  -- synthesized against it. Added by the same migration.
  preview_audio_url TEXT,
  UNIQUE (provider, provider_voice_id)
);

-- Each folder belongs to exactly one user's private library — see
-- document_folders below for how documents attach to folders.
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- owner_id makes every document belong to exactly one user's private
-- library. Read access for another user is granted only via an explicit
-- row in document_shares below — there is no "everyone can see everything"
-- mode.
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'docx', 'txt', 'epub', 'scan', 'url')),
  original_file_key TEXT NOT NULL,
  voice_id UUID REFERENCES voices(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error_message TEXT,
  last_position JSONB,
  summary TEXT,
  page_layout JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grants one other user read-only access to one document (+ its audio) —
-- the "share by username" feature. Sharing is owner-only: only the row's
-- owner_id user can create or revoke a share (see routes/documents.ts).
-- Recipients never get write access (delete, folder assignment, further
-- sharing) regardless of their own role.
CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, shared_with_user_id)
);

-- A document can belong to several folders at once (or none, "unfiled").
-- ON DELETE CASCADE on both sides so deleting a document or a folder just
-- drops the association rows, never the document itself. Added by
-- migrations/add_document_folders.sql, which replaced the earlier
-- single-folder documents.folder_id column.
CREATE TABLE IF NOT EXISTS document_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, folder_id)
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL,
  text_content TEXT NOT NULL,
  char_start INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'error')),
  audio_key TEXT,
  timing_data JSONB,
  duration_seconds NUMERIC,
  UNIQUE (document_id, sequence_index)
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  word_index INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
