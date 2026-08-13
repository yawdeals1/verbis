-- Verbis schema. See PRODUCT_PLAN.md §4 for the source-of-truth data model.
-- Run manually against the Deploro Postgres instance until a migration tool is introduced.

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'docx', 'scan')),
  original_file_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  last_position JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_voice_id TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL,
  text_content TEXT NOT NULL,
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
