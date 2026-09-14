import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from '../scripts/migrate.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'movie-studio-storage-'));
const dataDir = join(temporary, 'data');
process.env.DATA_DIR = dataDir;
const { FileObjectStore, LocalDatabase, StorageError, runtime } = await import('../lib/storage.ts');
assert.equal(existsSync(dataDir), false, 'Import must not create or migrate data');
assert.throws(() => runtime.DB, /db:migrate/);
assert.equal(existsSync(dataDir), false);
let db;
try {
  migrate(dataDir); migrate(dataDir);
  db = new LocalDatabase(dataDir);
  assert.equal((await db.prepare('PRAGMA journal_mode').first()).journal_mode, 'wal');
  assert.equal((await db.prepare('SELECT count(*) AS count FROM _local_migrations').first()).count, 2);
  const insert = (id, revision = 0) => db.prepare('INSERT INTO projects (id,owner,title,state,revision,updated) VALUES (?,?,?,?,?,?)').bind(id, 'owner', 'Title', '{}', revision, new Date().toISOString());
  await insert('project').run();
  assert.equal((await db.prepare('SELECT id FROM projects WHERE id=?').bind('absent').first()), null);
  assert.deepEqual((await db.prepare('SELECT id FROM projects').all()).results, [{ id: 'project' }]);
  const compete = () => db.prepare('UPDATE projects SET revision=revision+1 WHERE id=? AND revision=?').bind('project', 0).run();
  assert.deepEqual((await Promise.all([compete(), compete()])).map(result => result.meta.changes), [1, 0], 'Exactly one CAS writer wins');
  await assert.rejects(db.batch([insert('rollback'), insert('project')]), /UNIQUE/);
  assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind('rollback').first(), null, 'Failed batch is rolled back');
  await db.batch([insert('batch-a'), insert('batch-b')]);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM projects').first()).count, 3);
  db.close(); db = undefined;
  db = new LocalDatabase(dataDir);
  assert.equal((await db.prepare('SELECT revision FROM projects WHERE id=?').bind('project').first()).revision, 1, 'Database survives reopening');

  const files = new FileObjectStore(dataDir);
  assert.equal(await files.get('missing'), null);
  assert.equal(await files.head('missing'), null);
  const original = Buffer.from('0123456789abcdefghij');
  const key = 'project-state/user/project/../../still-an-opaque-key';
  const saved = await files.put(key, original, { httpMetadata: { contentType: 'application/octet-stream' } });
  assert.equal(saved.size, original.length);
  assert.equal(saved.etag, createHash('sha256').update(original).digest('hex'));
  assert.equal((await files.head(key)).httpMetadata.contentType, 'application/octet-stream');
  assert.deepEqual(Buffer.from(await (await files.get(key)).arrayBuffer()), original);
  const range = async (header, expected, offset) => {
    const value = await files.get(key, { range: new Headers({ range: header }) });
    assert.equal(value.size, original.length, 'Range metadata retains full size');
    assert.deepEqual(value.range, { offset, length: expected.length });
    assert.deepEqual(Buffer.from(await value.arrayBuffer()), Buffer.from(expected));
  };
  await range('bytes=2-5', '2345', 2);
  await range('bytes=15-', 'fghij', 15);
  await range('bytes=-4', 'ghij', 16);
  await range('bytes=17-999', 'hij', 17);
  await range('bytes=-999', original, 0);
  for (const header of ['bytes=20-', 'bytes=5-3', 'bytes=-0', 'bytes=0-1,4-5', 'garbage', 'bytes=-', 'bytes=9007199254740992-']) {
    await assert.rejects(files.get(key, { range: new Headers({ range: header }) }), error => error instanceof StorageError && error.status === 416 && error.contentRange === 'bytes */20');
  }
  await files.put('empty', new Uint8Array());
  assert.equal((await (await files.get('empty')).arrayBuffer()).byteLength, 0);
  await assert.rejects(files.get('empty', { range: new Headers({ range: 'bytes=0-' }) }), error => error.status === 416 && error.contentRange === 'bytes */0');
  const earlierReader = await files.get(key);
  await files.put(key, Buffer.from('replacement'));
  assert.deepEqual(Buffer.from(await earlierReader.arrayBuffer()), original, 'An ongoing read retains its object generation');
  assert.equal(Buffer.from(await (await files.get(key)).arrayBuffer()).toString(), 'replacement');
  await assert.rejects(files.put('', 'bad'), error => error.status === 400);
  await assert.rejects(files.put('x\0y', 'bad'), error => error.status === 400);
  assert.throws(() => files.resumeMultipartUpload('key', '../../escape'), error => error.status === 400);
  const objectDirectories = await readdir(join(dataDir, 'private-files', 'objects'));
  assert.ok(objectDirectories.every(name => /^[a-f0-9]{64}$/.test(name)), 'Object names cannot escape the hashed directory');
  if (process.platform !== 'win32') {
    assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dataDir, 'studio.sqlite'))).mode & 0o777, 0o600);
  }

  // A stream larger than individual writes verifies full writes and backpressure.
  const largeKey = 'large-stream', largeHash = createHash('sha256');
  let count = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (count === 48) { controller.close(); return; }
    const chunk = Buffer.alloc(128 * 1024, count++); largeHash.update(chunk); controller.enqueue(chunk);
  } });
  const large = await files.put(largeKey, stream);
  assert.equal(large.size, 6 * 1024 * 1024);
  const readHash = createHash('sha256'), body = (await files.get(largeKey)).body;
  for await (const chunk of body) { assert.ok(chunk.length <= 64 * 1024); readHash.update(chunk); }
  assert.equal(readHash.digest('hex'), largeHash.digest('hex'));

  const uploadKey = 'multipart-restart';
  const upload = await files.createMultipartUpload(uploadKey, { httpMetadata: { contentType: 'video/mp4' } });
  const part1 = await upload.uploadPart(1, Buffer.from('old'));
  const replacement = await upload.uploadPart(1, Buffer.from('new part one'));
  const part2 = await upload.uploadPart(2, Buffer.alloc(8 * 1024 * 1024, 42));
  assert.notEqual(part1.etag, replacement.etag);
  await assert.rejects(upload.complete([part1, part2]), error => error.status === 400);
  await assert.rejects(upload.complete([part2, replacement]), error => error.status === 400);
  await assert.rejects(upload.complete([replacement, replacement]), error => error.status === 400);
  await assert.rejects(upload.complete([replacement]), error => error.status === 400);
  await assert.rejects(upload.uploadPart(129, Buffer.from('bad')), error => error.status === 400);
  await assert.rejects(upload.uploadPart(3, Buffer.alloc(8 * 1024 * 1024 + 1)), error => error.status === 413);
  await assert.rejects(new FileObjectStore(dataDir).resumeMultipartUpload('wrong-owner-key', upload.uploadId).uploadPart(1, Buffer.from('bad')), error => error.status === 404);
  assert.equal(await files.head(uploadKey), null, 'Incomplete parts are private');

  // Complete using a fresh process, proving resume is backed by disk rather than memory.
  const childSource = `import {FileObjectStore} from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../lib/storage.ts', import.meta.url))).href)};
    const files = new FileObjectStore(process.env.DATA_DIR);
    const result = await files.resumeMultipartUpload('multipart-restart', process.env.TEST_UPLOAD).complete(JSON.parse(process.env.TEST_PARTS));
    process.stdout.write(JSON.stringify({size: result.size, etag: result.etag}));`;
  const completed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', childSource], { encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir, TEST_UPLOAD: upload.uploadId, TEST_PARTS: JSON.stringify([replacement, part2]) } }));
  assert.equal(completed.size, 12 + 8 * 1024 * 1024);
  const expectedHash = createHash('sha256').update('new part one').update(Buffer.alloc(8 * 1024 * 1024, 42)).digest('hex');
  assert.equal(completed.etag, expectedHash);
  assert.equal((await upload.complete([replacement, part2])).etag, expectedHash, 'Completion response retry is idempotent');
  await assert.rejects(upload.abort(), error => error.status === 409);
  await assert.rejects(upload.uploadPart(1, Buffer.from('late')), error => error.status === 409);
  assert.equal((await files.head(uploadKey)).etag, expectedHash, 'Abort never removes completed content');
  const resumedManifestPath = join(dataDir, 'private-files', 'uploads', upload.uploadId, 'upload.json');
  const interruptedManifest = JSON.parse(await readFile(resumedManifestPath, 'utf8'));
  interruptedManifest.state = 'open';
  await writeFile(resumedManifestPath, JSON.stringify(interruptedManifest));
  assert.equal((await upload.complete([replacement, part2])).etag, expectedHash, 'Recover publication before completion-state persistence');

  const aborted = await files.createMultipartUpload('aborted');
  await aborted.uploadPart(1, Buffer.from('never published'));
  await aborted.abort(); await aborted.abort();
  assert.equal(await files.head('aborted'), null);
  await assert.rejects(aborted.uploadPart(2, Buffer.from('late')), error => error.status === 409);
  assert.deepEqual((await readdir(join(dataDir, 'private-files', 'uploads', aborted.uploadId))).sort(), ['upload.json']);

  // A late retry and completion share one upload lock; completion sees a consistent part.
  const lockedUpload = await files.createMultipartUpload('locked-upload');
  const initial = await lockedUpload.uploadPart(1, Buffer.from('initial'));
  let unlock, entered;
  const gate = new Promise(resolve => { unlock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let sent = false;
  const pendingPart = lockedUpload.uploadPart(1, new ReadableStream({ async pull(controller) {
    if (sent) { controller.close(); return; }
    entered(); await gate; sent = true; controller.enqueue(Buffer.from('latest'));
  } }));
  await started;
  const pendingComplete = new FileObjectStore(dataDir).resumeMultipartUpload('locked-upload', lockedUpload.uploadId).complete([initial]);
  unlock(); await pendingPart;
  await assert.rejects(pendingComplete, error => error.status === 400, 'Completion rejects stale ETag after the locked part replacement');
  const finalPart = await lockedUpload.uploadPart(1, Buffer.from('latest'));
  await lockedUpload.complete([finalPart]);

  // Two upload sessions for one opaque key cannot replace each other's publication.
  const a = await files.createMultipartUpload('publish-race'), b = await files.createMultipartUpload('publish-race');
  const pa = await a.uploadPart(1, 'a'), pb = await b.uploadPart(1, 'b');
  const outcomes = await Promise.allSettled([a.complete([pa]), b.complete([pb])]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 409);

  // Migrations fail atomically and detect edited historical SQL.
  const migrationDir = join(temporary, 'migrations'); await mkdir(migrationDir);
  await writeFile(join(migrationDir, '0000_base.sql'), 'CREATE TABLE first_table (id TEXT PRIMARY KEY);');
  const migrationData = join(temporary, 'migration-data'); migrate(migrationData, migrationDir);
  await writeFile(join(migrationDir, '0001_bad.sql'), 'CREATE TABLE should_rollback (id TEXT); INVALID SQL;');
  assert.throws(() => migrate(migrationData, migrationDir), /syntax error/);
  const migrationDb = new LocalDatabase(migrationData);
  try { assert.equal(await migrationDb.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").first(), null); }
  finally { migrationDb.close(); }
  await writeFile(join(migrationDir, '0000_base.sql'), 'CREATE TABLE edited_table (id TEXT);');
  assert.throws(() => migrate(migrationData, migrationDir), /Applied migration changed/);
  console.log('PASS local storage: real SQLite migrations/CAS/transaction rollback, private atomic files, byte ranges/416, bounded streaming, multipart restart/retries/ETag validation/locking/abort/recovery. No provider calls.');
} finally {
  db?.close();
  // The target is the explicitly created isolated OS temporary test directory.
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unsafe test cleanup target');
  await rm(temporary, { recursive: true, force: true });
}
