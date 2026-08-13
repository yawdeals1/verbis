// TODO(Phase 1): POST to /documents with a PDF/DOCX file, show processing state,
// navigate to /reader/:documentId once the first chunk is ready.
// TODO(Phase 2): camera capture / photo upload path through OCR.
export default function Import() {
  return (
    <section>
      <h1>Import</h1>
      <label>
        Upload PDF or DOCX
        <input type="file" accept=".pdf,.docx" />
      </label>
      <p>Book scan (camera/photo) lands in Phase 2.</p>
    </section>
  )
}
