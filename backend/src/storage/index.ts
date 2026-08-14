import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { env } from '../config/env.js'

let s3Client: S3Client | undefined

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: env.s3Endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
      forcePathStyle: true,
    })
  }
  return s3Client
}

function localPath(key: string): string {
  return path.join(process.cwd(), env.localStorageDir, key)
}

/**
 * Object storage for original uploads and generated audio. Uses the
 * self-hosted S3-compatible bucket when S3_* env vars are set (production/
 * Deploro), otherwise falls back to local disk under `backend/storage/` so
 * the app is runnable before that infra is provisioned.
 */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<string> {
  if (env.s3Configured) {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    )
    return key
  }

  const filePath = localPath(key)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, data)
  return key
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (env.s3Configured) {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }),
    )
    const stream = result.Body as Readable
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  return readFile(localPath(key))
}
