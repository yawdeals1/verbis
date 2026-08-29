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

  // Deploro Auth-as-a-Service for the project's own end users (invite-only
  // sign-in — see lib/deploroAuth.ts). Base URL is the Deploro worker itself
  // (same host as `deploro baseUrl` in ~/.deploro/credentials.json), not
  // this app's own domain — auth is proxied server-to-server because the
  // session cookie Deploro issues is scoped to its own worker domain, not
  // Verbis's.
  get deploroAuthBaseUrl() {
    return required('DEPLORO_AUTH_BASE_URL').replace(/\/+$/, '')
  },
  get deploroAuthSlug() {
    return optional('DEPLORO_AUTH_SLUG') ?? 'verbis'
  },
  // Which origin the frontend is served from, for CORS credentialed
  // requests. In production the frontend and backend are same-origin
  // (nginx proxies /api/* — see deploro.compose.yml), so this only matters
  // for local dev where Vite (5173) and the API (3001) are cross-origin.
  get frontendOrigin() {
    return optional('FRONTEND_ORIGIN') ?? 'http://localhost:5173'
  },
  // The `verbis_session` cookie's Secure flag — must be false for local
  // dev over plain http://, true in any real deployment.
  get sessionCookieSecure(): boolean {
    return (optional('SESSION_COOKIE_SECURE') ?? (this.nodeEnv === 'production' ? 'true' : 'false')) === 'true'
  },
  // Which TTS backend generates chunk audio. `speechify` is the default:
  // its speech marks carry per-word character offsets and times in the same
  // response as the audio, which is what synced highlighting needs. Set to
  // `elevenlabs` to switch; both produce the same character-anchored timing,
  // so previously generated audio stays valid either way.
  get ttsProvider(): 'speechify' | 'elevenlabs' {
    const value = optional('TTS_PROVIDER') ?? 'speechify'
    if (value !== 'speechify' && value !== 'elevenlabs') {
      throw new Error(`Invalid TTS_PROVIDER: ${value}. Expected 'speechify' or 'elevenlabs'.`)
    }
    return value
  },
  get speechifyApiKey() {
    return required('SPEECHIFY_API_KEY')
  },
  // Configurable because Speechify has moved its API host once already
  // (api.sws.speechify.com -> api.speechify.ai) and the older host still
  // answers, so a redirect or a cutover is fixable without a code change.
  get speechifyBaseUrl() {
    return (optional('SPEECHIFY_BASE_URL') ?? 'https://api.speechify.ai/v1').replace(/\/+$/, '')
  },
  // simba-3.0 is Speechify's own default and the one model that accepts the
  // whole voice catalog. simba-3.2 sounds better but is English-only and
  // limited to eight curated voices, so switching model also narrows what
  // `GET /voices` may offer (see listVoices in services/speechify.ts).
  get speechifyModel() {
    return optional('SPEECHIFY_MODEL') ?? 'simba-3.0'
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

  // Deploro project storage (R2), the production backend for originals and
  // generated audio. Its routes are siblings of the Studio DB API rather
  // than children of it, so this is DEPLORO_API_URL without the trailing
  // `/studio` — kept as its own var so unsetting it falls through to S3 and
  // then local disk. Deploro exposes no S3-compatible endpoint and issues no
  // S3 keys for this bucket, which is why it can't just be an S3_ENDPOINT.
  // Writes require a project-admin token; a member-scoped one 403s.
  get deploroStorageConfigured(): boolean {
    return Boolean(optional('DEPLORO_STORAGE_URL'))
  },
  get deploroStorageUrl() {
    return required('DEPLORO_STORAGE_URL').replace(/\/+$/, '')
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
