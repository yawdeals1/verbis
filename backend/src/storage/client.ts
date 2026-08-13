import { S3Client } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'

let client: S3Client | undefined

// Lazy singleton, S3-compatible (e.g. Hetzner Object Storage) rather than AWS-specific.
export function getStorageClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.s3Endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
      forcePathStyle: true,
    })
  }
  return client
}

export const storageBucket = () => env.s3Bucket
