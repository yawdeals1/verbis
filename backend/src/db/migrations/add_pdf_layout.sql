-- Adds real-PDF-rendering support: per-word bounding boxes on documents
-- (page_layout) and each chunk's starting offset within the document's
-- full extracted text (char_start), used to map a chunk's TTS word timing
-- back onto a position on the rendered page. See schema.sql for the full
-- table definitions this extends.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_layout JSONB;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS char_start INTEGER;
