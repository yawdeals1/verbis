import { useParams } from 'react-router-dom'

// TODO(Phase 1): load document chunks, drive an <audio> element, sync word highlighting
// via `timeupdate` against each chunk's timing_data, and wire tap-to-jump.
export default function Reader() {
  const { documentId } = useParams<{ documentId: string }>()

  return (
    <section>
      <h1>Reader</h1>
      <p>Document: {documentId}</p>
      <div style={{ minHeight: '40vh', border: '1px solid #ccc', padding: '1rem' }}>
        Document text will render here, with the current word highlighted in sync with audio.
      </div>
      <div style={{ position: 'sticky', bottom: 0, padding: '1rem 0' }}>
        {/* TODO: play/pause, skip back/forward, speed control, voice selector, progress scrubber */}
        <audio controls style={{ width: '100%' }} />
      </div>
    </section>
  )
}
