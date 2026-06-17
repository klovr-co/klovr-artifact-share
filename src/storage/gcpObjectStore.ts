import type { Bucket, Storage } from "@google-cloud/storage";
import { ObjectNotFoundError, type ObjectStore, type StoredObject } from "./objectStore";

export class CloudStorageObjectStore implements ObjectStore {
  private readonly bucket: Bucket;

  constructor(storage: Storage, bucketName: string) {
    this.bucket = storage.bucket(bucketName);
  }

  async put(path: string, object: string | Buffer, contentType?: string): Promise<void> {
    await this.bucket.file(path).save(object, {
      contentType: contentType ?? "text/html; charset=utf-8",
      resumable: false
    });
  }

  async get(path: string): Promise<StoredObject> {
    const file = this.bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError(path);
    }
    const [[contents], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = metadata.contentType ?? "application/octet-stream";
    if (contentType.startsWith("text/html")) {
      return contents.toString("utf8");
    }
    return {
      body: contents,
      contentType
    };
  }

  async delete(path: string): Promise<void> {
    await this.bucket.file(path).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.bucket.deleteFiles({
      force: true,
      prefix
    });
  }
}
