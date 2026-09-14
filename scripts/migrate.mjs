import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Startup only: request handlers and Next build never apply schema changes.
export function migrate(dataDir = process.env.DATA_DIR || './data', migrationDir = fileURLToPath(new URL('../drizzle/', import.meta.url))) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const filename = join(directory, 'studio.sqlite');
  const db = new DatabaseSync(filename);
  try {
    chmodSync(filename, 0o600);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied TEXT NOT NULL)');
    for (const name of readdirSync(migrationDir).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = readFileSync(join(migrationDir, name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const applied = db.prepare('SELECT sha256 FROM _local_migrations WHERE name=?').get(name);
        if (applied && applied.sha256 !== digest) throw new Error(`Applied migration changed: ${name}`);
        if (!applied) {
          db.exec(sql);
          db.prepare('INSERT INTO _local_migrations (name,sha256,applied) VALUES (?,?,?)').run(name, digest, new Date().toISOString());
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    // SQLite auxiliary files inherit database permissions; enforce on existing ones too.
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(filename + suffix)) chmodSync(filename + suffix, 0o600);
  } finally { db.close(); }
  return filename;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  migrate();
  console.log('Local SQLite migrations are up to date.');
}
