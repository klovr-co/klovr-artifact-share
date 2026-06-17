export type StoredObject =
  | string
  | {
      body: Buffer;
      contentType: string;
    };

export interface ObjectStore {
  put(path: string, object: string | Buffer, contentType?: string): Promise<void>;
  get(path: string): Promise<StoredObject>;
  delete(path: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(path: string) {
    super(`Object not found: ${path}`);
    this.name = "ObjectNotFoundError";
  }
}

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(path: string, object: string | Buffer, contentType?: string): Promise<void> {
    this.objects.set(
      path,
      typeof object === "string"
        ? object
        : {
            body: Buffer.from(object),
            contentType: contentType ?? "application/octet-stream"
          }
    );
  }

  async get(path: string): Promise<StoredObject> {
    const object = this.objects.get(path);
    if (object === undefined) {
      throw new ObjectNotFoundError(path);
    }
    return object;
  }

  async delete(path: string): Promise<void> {
    this.objects.delete(path);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const path of this.objects.keys()) {
      if (path.startsWith(prefix)) {
        this.objects.delete(path);
      }
    }
  }
}
