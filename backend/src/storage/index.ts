import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { env } from '../config/env.js'
import * as deploroStorage from './deploroStorage.js'

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
 * Object storage for original uploads and generated audio, over one of three
 * backends picked in this order:
 *
 * 1. Deploro project storage (R2), when DEPLORO_STORAGE_URL is set — what
 *    production uses. Private bucket; reads are proxied back out through
 *    this API rather than served as public URLs.
 * 2. An S3-compatible bucket, when the S3_* vars are set.
 * 3. Local disk under `backend/storage/`, so the app is runnable with no
 *    storage infra provisioned at all.
 */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<string> {
  if (env.deploroStorageConfigured) {
    await deploroStorage.putObject(key, data, contentType)
    return key
  }

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
  if (env.deploroStorageConfigured) {
    return deploroStorage.getObjectBuffer(key)
  }

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

/** Deletes one stored object. Missing objects are not an error — deleting a document should succeed even if a file was already gone. */
export async function deleteObject(key: string): Promise<void> {
  if (env.deploroStorageConfigured) {
    await deploroStorage.deleteObject(key)
    return
  }

  if (env.s3Configured) {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }))
    return
  }

  await rm(localPath(key), { force: true })
}
