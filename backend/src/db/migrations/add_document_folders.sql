-- Replaces documents.folder_id (one folder per document) with a
-- document_folders join table so a document can belong to several
-- folders at once. See PRODUCT_PLAN.md §4 for the full data model.
CREATE TABLE IF NOT EXISTS document_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, folder_id)
);

INSERT INTO document_folders (document_id, folder_id)
SELECT id, folder_id FROM documents WHERE folder_id IS NOT NULL;

ALTER TABLE documents DROP COLUMN IF EXISTS folder_id;
