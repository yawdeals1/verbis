-- Adds voice locale (for ranking American/British voices first in the
-- picker) and a hosted preview clip URL (to hear a voice before any text is
-- synthesized against it). See schema.sql for the full table definition.
ALTER TABLE voices ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE voices ADD COLUMN IF NOT EXISTS preview_audio_url TEXT;
