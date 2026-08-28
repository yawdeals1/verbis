import { ForwardIcon, NextSectionIcon, PauseIcon, PlayIcon, PrevSectionIcon, RewindIcon } from './icons'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  playbackRate: number
  hasNextChunk: boolean
  hasPrevChunk: boolean
  onTogglePlay: () => void
  onSkip: (deltaSeconds: number) => void
  onPrevChunk: () => void
  onNextChunk: () => void
  onSeek: (seconds: number) => void
  onSetPlaybackRate: (rate: number) => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PlaybackBar({
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  hasNextChunk,
  hasPrevChunk,
  onTogglePlay,
  onSkip,
  onPrevChunk,
  onNextChunk,
  onSeek,
  onSetPlaybackRate,
}: Props) {
  return (
    <div className="playback-bar">
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Playback position"
      />
      <div className="playback-bar-time">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="playback-bar-controls">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onPrevChunk} disabled={!hasPrevChunk} aria-label="Previous section">
          <PrevSectionIcon />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onSkip(-10)} aria-label="Rewind 10 seconds">
          <RewindIcon />
        </button>
        <button type="button" className="playback-bar-play" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onSkip(10)} aria-label="Skip forward 10 seconds">
          <ForwardIcon />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onNextChunk} disabled={!hasNextChunk} aria-label="Next section">
          <NextSectionIcon />
        </button>

        <div className="playback-bar-speed">
          <label className="reader-inline-label">
            <span className="visually-hidden">Playback speed</span>
            <select className="input" value={playbackRate} onChange={(e) => onSetPlaybackRate(Number(e.target.value))}>
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}
