import { Link } from 'react-router-dom'

// TODO(Phase 1): fetch documents from GET /documents, render title/thumbnail/progress/last-read.
export default function Library() {
  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Library</h1>
        <Link to="/import">+ Import</Link>
      </header>
      <p>No documents yet. Import a PDF, DOCX, or scan a book page to get started.</p>
    </section>
  )
}
