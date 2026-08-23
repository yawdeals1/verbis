import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

let resolvedCredentialsPath: string | undefined

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Lazily validated — only thrown when a route actually needs a given
  // provider, so `npm run dev` works before every key is provisioned.
  //
  // No direct Postgres connection — the backend talks to Deploro's
  // per-project Studio REST API instead (see db/studioClient.ts), so it
  // doesn't need Deploro VPS compute just to reach its own database.
  // DEPLORO_API_TOKEN is a project-scoped PAT minted via
  // `deploro token create --project verbis`.
  get deploroApiUrl() {
    return required('DEPLORO_API_URL')
  },
  get deploroApiToken() {
    return required('DEPLORO_API_TOKEN')
  },
  // Which TTS backend generates chunk audio. `kokoro` is a self-hosted
  // Kokoro-82M container (see the `kokoro` service in deploro.compose.yml) —
  // no API key and no per-character billing, at the cost of running at
  // roughly playback speed on CPU. Set to `elevenlabs` to switch back; both
  // produce the same character-anchored timing, so previously generated
  // audio stays valid either way.
  get ttsProvider(): 'kokoro' | 'elevenlabs' {
    const value = optional('TTS_PROVIDER') ?? 'kokoro'
    if (value !== 'kokoro' && value !== 'elevenlabs') {
      throw new Error(`Invalid TTS_PROVIDER: ${value}. Expected 'kokoro' or 'elevenlabs'.`)
    }
    return value
  },
  get kokoroBaseUrl() {
    return optional('KOKORO_BASE_URL') ?? 'http://kokoro:8880'
  },
  // A full chunk can take about as long to synthesize as it takes to play
  // back, so this is sized against MAX_CHUNK_CHARS (~1000 chars, ~70s of
  // audio) with generous headroom for a loaded shared VPS.
  get kokoroTimeoutMs() {
    return Number(optional('KOKORO_TIMEOUT_MS') ?? 600_000)
  },

  get elevenLabsApiKey() {
    return required('ELEVENLABS_API_KEY')
  },
  // Left at multilingual_v2 so switching TTS_PROVIDER back reproduces the
  // previous output exactly. `eleven_flash_v2_5` is half the price per
  // character and supports the same with-timestamps endpoint.
  get elevenLabsModelId() {
    return optional('ELEVENLABS_MODEL_ID') ?? 'eleven_multilingual_v2'
  },
  // `GOOGLE_APPLICATION_CREDENTIALS` (a file path) works for local dev where
  // the key file sits on disk. Deploro's `vps set-env` can only set string
  // env vars, not upload a file — so in that environment, set
  // `GOOGLE_APPLICATION_CREDENTIALS_JSON` to the service account key's JSON
  // contents, base64-encoded, and this writes it to a temp file once and
  // points `GOOGLE_APPLICATION_CREDENTIALS` at it before first use.
  get googleCloudVisionCredentials() {
    const jsonB64 = optional('GOOGLE_APPLICATION_CREDENTIALS_JSON')
    if (jsonB64) {
      if (!resolvedCredentialsPath) {
        resolvedCredentialsPath = path.join(tmpdir(), 'gcloud-credentials.json')
        writeFileSync(resolvedCredentialsPath, Buffer.from(jsonB64, 'base64'))
      }
      return resolvedCredentialsPath
    }
    return required('GOOGLE_APPLICATION_CREDENTIALS')
  },

  // Local Ollama for Phase 4 summarize/Q&A. Model tag is configurable so the
  // exact Gemma 4 variant (gemma4:e2b/e4b/26b/31b/31b-cloud) can change
  // without a code change. No API key needed for a local `ollama serve` on
  // localhost — OLLAMA_API_KEY is optional and only relevant if OLLAMA_BASE_URL
  // points at Ollama's cloud API directly, or a self-hosted instance sitting
  // behind a reverse proxy that requires one.
  get ollamaBaseUrl() {
    return optional('OLLAMA_BASE_URL') ?? 'http://localhost:11434'
  },
  get ollamaModel() {
    return optional('OLLAMA_MODEL') ?? 'gemma4:31b-cloud'
  },
  get ollamaApiKey() {
    return optional('OLLAMA_API_KEY')
  },

  // S3-compatible storage is optional in dev: when unset, storage falls back
  // to local disk (see src/storage/index.ts) so the app runs before Deploro
  // object storage is provisioned.
  get s3Configured(): boolean {
    return Boolean(
      optional('S3_ENDPOINT') &&
        optional('S3_BUCKET') &&
        optional('S3_ACCESS_KEY_ID') &&
        optional('S3_SECRET_ACCESS_KEY'),
    )
  },
  get s3Endpoint() {
    return required('S3_ENDPOINT')
  },
  get s3Bucket() {
    return required('S3_BUCKET')
  },
  get s3AccessKeyId() {
    return required('S3_ACCESS_KEY_ID')
  },
  get s3SecretAccessKey() {
    return required('S3_SECRET_ACCESS_KEY')
  },

  get localStorageDir() {
    return optional('LOCAL_STORAGE_DIR') ?? 'storage'
  },
}
