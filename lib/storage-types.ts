// The small storage surface used by the application. No provider globals.
export type SqlValue = string | number | bigint | null | Uint8Array;
export interface QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: { changes: number };
}
export interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<QueryResult[]>;
}
export type ObjectInput = ArrayBuffer | Uint8Array | string | ReadableStream<Uint8Array>;
export interface ObjectOptions { httpMetadata?: { contentType?: string } }
export interface StoredObject {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata: { contentType?: string };
}
export interface StoredObjectBody extends StoredObject {
  body: ReadableStream<Uint8Array>;
  range?: { offset: number; length: number };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface UploadedPart { partNumber: number; etag: string }
export interface MultipartUpload {
  key: string;
  uploadId: string;
  uploadPart(partNumber: number, value: ObjectInput): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<StoredObject>;
  abort(): Promise<void>;
}
export interface ObjectStore {
  put(key: string, value: ObjectInput, options?: ObjectOptions): Promise<StoredObject>;
  get(key: string, options?: { range?: Headers }): Promise<StoredObjectBody | null>;
  head(key: string): Promise<StoredObject | null>;
  createMultipartUpload(key: string, options?: ObjectOptions): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
}
