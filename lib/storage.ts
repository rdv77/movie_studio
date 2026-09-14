import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, chmod, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Database, PreparedStatement, QueryResult, SqlValue, ObjectInput, ObjectOptions, ObjectStore, StoredObject, StoredObjectBody, MultipartUpload, UploadedPart } from './storage-types';

export class StorageError extends Error {
  status: number;
  contentRange?: string;
  constructor(message: string, status = 500, contentRange?: string) {
    super(message); this.name = 'StorageError'; this.status = status; this.contentRange = contentRange;
  }
}

class Statement implements PreparedStatement {
  database: LocalDatabase;
  sql: string;
  values: SqlValue[];
  constructor(database: LocalDatabase, sql: string, values: SqlValue[] = []) {
    this.database = database; this.sql = sql; this.values = values;
  }
  bind(...values: SqlValue[]) { return new Statement(this.database, this.sql, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.database.connection.prepare(this.sql).get(...this.values);
    return row ? { ...row } as T : null;
  }
  async all<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    return { results: this.database.connection.prepare(this.sql).all(...this.values).map(row => ({ ...row }) as T), success: true, meta: { changes: 0 } };
  }
  execute(): QueryResult {
    const statement = this.database.connection.prepare(this.sql);
    if (statement.columns().length) return { results: statement.all(...this.values).map(row => ({ ...row })), success: true, meta: { changes: 0 } };
    const result = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}

export class LocalDatabase implements Database {
  connection: DatabaseSync;
  constructor(dataDir = process.env.DATA_DIR || './data') {
    const filename = join(resolve(dataDir), 'studio.sqlite');
    if (!existsSync(filename)) throw new StorageError('База данных не подготовлена. Запустите npm run db:migrate перед запуском студии.');
    this.connection = new DatabaseSync(filename);
    this.connection.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }
  prepare(sql: string): PreparedStatement { return new Statement(this, sql); }
  async batch(statements: PreparedStatement[]): Promise<QueryResult[]> {
    if (!statements.every(statement => statement instanceof Statement && statement.database === this)) throw new StorageError('Batch statements must belong to the same database.');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      // No await inside a transaction: another request cannot interleave its SQL.
      const results = statements.map(statement => (statement as Statement).execute());
      this.connection.exec('COMMIT');
      return results;
    } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() { this.connection.close(); }
}

type ObjectRecord = { version: 1; key: string; file: string; size: number; etag: string; uploaded: string; contentType?: string; uploadId?: string };
type PartRecord = UploadedPart & { file: string; size: number };
type UploadRecord = { version: 1; key: string; uploadId: string; state: 'open' | 'complete' | 'aborted'; contentType?: string; parts: Record<string, PartRecord> };
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const filePattern = /^[a-f0-9-]{36}\.blob$/;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const locks = new Map<string, Promise<void>>();

// All instances in one Node process share locks. Do not run multiple app replicas
// against this directory; SQLite WAL does not provide cross-process blob locks.
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(key, current);
  await prior;
  try { return await fn(); }
  finally { release(); if (locks.get(key) === current) locks.delete(key); }
}
function keyHash(key: string) {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 2048 || key.includes('\0')) throw new StorageError('Недопустимый ключ файла.', 400);
  // Keys are opaque labels, never paths (including slash-containing snapshots).
  return hash(key);
}
async function privateDirectory(path: string) { await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); }
async function syncDirectory(path: string) {
  // Windows does not allow opening a directory for fsync.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(directory: string, name: string, value: unknown) {
  const temporary = join(directory, randomUUID() + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, join(directory, name)); await syncDirectory(directory); }
  finally { await rm(temporary, { force: true }); }
}
async function json<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function* chunks(value: ObjectInput): AsyncGenerator<Uint8Array> {
  if (typeof value === 'string') { yield Buffer.from(value); return; }
  if (value instanceof ArrayBuffer) { yield new Uint8Array(value); return; }
  if (ArrayBuffer.isView(value)) { yield value; return; }
  const reader = value.getReader();
  let finished = false;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) { finished = true; break; }
      if (!(item.value instanceof Uint8Array)) throw new StorageError('Файл содержит недопустимые данные.', 400);
      yield item.value;
    }
  } finally { if (!finished) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function writeBlob(directory: string, data: AsyncIterable<Uint8Array>, maxSize = Number.MAX_SAFE_INTEGER) {
  const file = randomUUID() + '.blob';
  const path = join(directory, file);
  const handle = await open(path, 'wx', 0o600);
  const digest = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of data) {
      size += chunk.byteLength;
      if (!Number.isSafeInteger(size) || size > maxSize) throw new StorageError('Файл слишком большой.', 413);
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (!result.bytesWritten) throw new StorageError('Не удалось записать файл.');
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
  } catch (error) { await handle.close(); await rm(path, { force: true }); throw error; }
  await handle.close();
  return { file, size, etag: digest.digest('hex') };
}
function object(record: ObjectRecord): StoredObject {
  return { key: record.key, size: record.size, etag: record.etag, uploaded: new Date(record.uploaded), httpMetadata: { contentType: record.contentType } };
}
function byteRange(header: string | null, size: number): { offset: number; length: number } | undefined {
  if (!header) return;
  const fail = () => new StorageError('Запрошенный диапазон файла недоступен.', 416, `bytes */${size}`);
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || !size) throw fail();
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw fail();
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) throw fail();
  return { offset: start, length: Math.min(requestedEnd, size - 1) - start + 1 };
}

export class FileObjectStore implements ObjectStore {
  directory: string;
  constructor(dataDir = process.env.DATA_DIR || './data') { this.directory = join(resolve(dataDir), 'private-files'); }
  private objectDirectory(key: string) { return join(this.directory, 'objects', keyHash(key)); }
  private uploadDirectory(uploadId: string) {
    if (!uuidPattern.test(uploadId)) throw new StorageError('Недопустимый идентификатор загрузки.', 400);
    return join(this.directory, 'uploads', uploadId);
  }
  private async record(key: string) {
    const record = await json<ObjectRecord>(join(this.objectDirectory(key), 'object.json'));
    if (record && (record.version !== 1 || record.key !== key || !filePattern.test(record.file) || !Number.isSafeInteger(record.size) || record.size < 0)) throw new StorageError('Повреждены метаданные файла.');
    return record;
  }
  private async init() {
    await privateDirectory(resolve(this.directory, '..'));
    await privateDirectory(this.directory);
    await privateDirectory(join(this.directory, 'objects'));
    await privateDirectory(join(this.directory, 'uploads'));
  }
  async head(key: string): Promise<StoredObject | null> {
    const record = await this.record(key);
    if (!record) return null;
    const handle = await open(join(this.objectDirectory(key), record.file), 'r');
    try { if ((await handle.stat()).size !== record.size) throw new StorageError('Поврежден сохранённый файл.'); }
    finally { await handle.close(); }
    return object(record);
  }
  async put(key: string, value: ObjectInput, options?: ObjectOptions): Promise<StoredObject> {
    const directory = this.objectDirectory(key);
    await this.init(); await privateDirectory(directory);
    return locked(directory, async () => {
      const saved = await writeBlob(directory, chunks(value));
      const record: ObjectRecord = { version: 1, key, ...saved, uploaded: new Date().toISOString(), contentType: options?.httpMetadata?.contentType };
      // Publish a single pointer after the complete immutable data file is fsynced.
      // Prior generations remain valid for readers which already saw their pointer.
      await atomicJson(directory, 'object.json', record);
      return object(record);
    });
  }
  async get(key: string, options?: { range?: Headers }): Promise<StoredObjectBody | null> {
    const record = await this.record(key);
    if (!record) return null;
    const range = byteRange(options?.range?.get('range') ?? null, record.size);
    const handle = await open(join(this.objectDirectory(key), record.file), 'r');
    let position = range?.offset ?? 0, remaining = range?.length ?? record.size, closed = false;
    const close = async () => { if (!closed) { closed = true; await handle.close(); } };
    try { if ((await handle.stat()).size !== record.size) throw new StorageError('Поврежден сохранённый файл.'); }
    catch (error) { await close(); throw error; }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!remaining) { await close(); controller.close(); return; }
          const buffer = new Uint8Array(Math.min(64 * 1024, remaining));
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
          if (!bytesRead) throw new StorageError('Сохранённый файл прочитан не полностью.');
          position += bytesRead; remaining -= bytesRead; controller.enqueue(buffer.subarray(0, bytesRead));
          if (!remaining) { await close(); controller.close(); }
        } catch (error) { await close(); controller.error(error); }
      },
      cancel: close,
    });
    return { ...object(record), range, body, arrayBuffer: () => new Response(body).arrayBuffer() };
  }
  async createMultipartUpload(key: string, options?: ObjectOptions): Promise<MultipartUpload> {
    keyHash(key); await this.init();
    if (await this.record(key)) throw new StorageError('Файл уже существует.', 409);
    const uploadId = randomUUID(), directory = this.uploadDirectory(uploadId);
    await privateDirectory(directory);
    await atomicJson(directory, 'upload.json', { version: 1, key, uploadId, state: 'open', contentType: options?.httpMetadata?.contentType, parts: {} } satisfies UploadRecord);
    return this.resumeMultipartUpload(key, uploadId);
  }
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload {
    keyHash(key);
    const directory = this.uploadDirectory(uploadId);
    const read = async () => {
      const record = await json<UploadRecord>(join(directory, 'upload.json'));
      if (!record || record.key !== key || record.uploadId !== uploadId) throw new StorageError('Загрузка не найдена.', 404);
      if (record.version !== 1 || !['open', 'complete', 'aborted'].includes(record.state) || !record.parts || Object.values(record.parts).some(part => !filePattern.test(part.file) || !Number.isSafeInteger(part.size) || part.size < 0)) throw new StorageError('Повреждены метаданные загрузки.');
      return record;
    };
    const requireOpen = (record: UploadRecord) => { if (record.state !== 'open') throw new StorageError('Загрузка уже завершена или отменена.', 409); };
    const save = (record: UploadRecord) => atomicJson(directory, 'upload.json', record);
    const cleanParts = async (record: UploadRecord) => { for (const part of Object.values(record.parts)) await rm(join(directory, part.file), { force: true }); };
    return {
      key, uploadId,
      uploadPart: (partNumber, value) => locked(directory, async () => {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 128) throw new StorageError('Недопустимый номер части.', 400);
        const record = await read(); requireOpen(record);
        if (await this.record(key)) throw new StorageError('Файл уже сохранён.', 409);
        const saved = await writeBlob(directory, chunks(value), 8 * 1024 * 1024);
        if (!saved.size) { await rm(join(directory, saved.file), { force: true }); throw new StorageError('Пустая часть файла.', 400); }
        const oldPart = record.parts[String(partNumber)];
        record.parts[String(partNumber)] = { ...saved, partNumber };
        await save(record);
        if (oldPart) await rm(join(directory, oldPart.file), { force: true });
        return { partNumber, etag: saved.etag };
      }),
      complete: parts => locked(directory, async () => {
        const record = await read();
        if (record.state === 'aborted') throw new StorageError('Загрузка отменена.', 409);
        if (!parts.length || parts.length > 128 || parts.length !== Object.keys(record.parts).length || parts.some((part, index) => part.partNumber !== index + 1 || record.parts[String(part.partNumber)]?.etag !== part.etag)) throw new StorageError('Переданы не все части файла, изменён ETag или нарушен порядок.', 400);
        const objectDirectory = this.objectDirectory(key);
        await privateDirectory(objectDirectory);
        return locked(objectDirectory, async () => {
          const existing = await this.record(key);
          if (existing) {
            if (existing.uploadId !== uploadId) throw new StorageError('Файл сохранён другой загрузкой.', 409);
            record.state = 'complete'; await save(record); await cleanParts(record);
            return object(existing);
          }
          requireOpen(record);
          async function* concatenate() {
            for (const requested of parts) {
              const part = record.parts[String(requested.partNumber)];
              const handle = await open(join(directory, part.file), 'r');
              const digest = createHash('sha256'); let length = 0;
              try {
                if ((await handle.stat()).size !== part.size) throw new StorageError('Часть файла повреждена.');
                const buffer = new Uint8Array(64 * 1024);
                while (true) {
                  const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, length);
                  if (!bytesRead) break;
                  const chunk = buffer.subarray(0, bytesRead); length += bytesRead; digest.update(chunk); yield chunk;
                }
                if (length !== part.size || digest.digest('hex') !== part.etag) throw new StorageError('Часть файла повреждена.');
              } finally { await handle.close(); }
            }
          }
          const saved = await writeBlob(objectDirectory, concatenate(), 1024 * 1024 * 1024);
          const final: ObjectRecord = { version: 1, key, ...saved, uploaded: new Date().toISOString(), contentType: record.contentType, uploadId };
          await atomicJson(objectDirectory, 'object.json', final);
          record.state = 'complete'; await save(record); await cleanParts(record);
          return object(final);
        });
      }),
      abort: () => locked(directory, async () => {
        const record = await read();
        if (record.state === 'aborted') return;
        if (record.state === 'complete' || (await this.record(key))?.uploadId === uploadId) throw new StorageError('Загрузка уже завершена. Сохранённый файл не удалён.', 409);
        record.state = 'aborted'; await save(record); await cleanParts(record);
      }),
    };
  }
}

// Global caching survives Next development module reloads. Construction happens on
// first request only; importing modules during next build never creates data files.
type LocalRuntimeCache = { directory: string; DB?: LocalDatabase; FILES?: FileObjectStore };
const globals = globalThis as typeof globalThis & { __movieStudioStorage?: LocalRuntimeCache };
function cache() {
  const directory = resolve(process.env.DATA_DIR || './data');
  if (!globals.__movieStudioStorage || globals.__movieStudioStorage.directory !== directory) {
    globals.__movieStudioStorage?.DB?.close();
    globals.__movieStudioStorage = { directory };
  }
  return globals.__movieStudioStorage;
}
export const runtime = {
  get DB(): Database { const state = cache(); return state.DB ??= new LocalDatabase(state.directory); },
  get FILES(): ObjectStore { const state = cache(); return state.FILES ??= new FileObjectStore(state.directory); },
  get VAULT_KEY(): string | undefined { return process.env.VAULT_KEY; },
};
