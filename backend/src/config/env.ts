import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Lazily validated — only thrown when a route actually needs a given
  // provider, so `npm run dev` works before every key is provisioned.
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get elevenLabsApiKey() {
    return required('ELEVENLABS_API_KEY')
  },
  get googleCloudVisionCredentials() {
    return required('GOOGLE_APPLICATION_CREDENTIALS')
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
}
