// FILE LOCATION: backend/tests/migrationPortability.test.js
// DESCRIPTION: Static guards over the migration scripts. Production runs on
//              TiDB, CI and local validation on MySQL 8 — DDL must be valid on
//              both, and most migrations swallow statement errors (log + exit
//              0), so an unsupported statement fails SILENTLY at deploy time.
//              - TiDB rejects adding a STORED generated column with ALTER TABLE
//                (user_addresses.countryCode was one; now VIRTUAL).
//              - `DROP COLUMN/INDEX IF EXISTS` and `ADD COLUMN IF NOT EXISTS`
//                are MariaDB syntax; MySQL 8 rejects them (both shipped
//                down() functions used them and could not run).
//              - every script named in `npm run db:migrate` must exist, or the
//                chain stops half-way on a deploy that forgot to add the file.
//              No database is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationFiles = readdirSync(backendDir).filter((f) => /^migrate.*\.js$/.test(f));

test('migration scripts were found', () => {
  assert.ok(migrationFiles.length > 20, `found ${migrationFiles.length}`);
});

test('no STORED generated column is added via ALTER TABLE (unsupported on TiDB)', () => {
  const offenders = [];
  for (const file of migrationFiles) {
    const src = readFileSync(join(backendDir, file), 'utf8');
    // Column specs are often built in arrays and spliced into `ADD COLUMN`,
    // so any GENERATED … STORED spec in a migration script is an ALTER add.
    for (const m of src.matchAll(/GENERATED\s+ALWAYS\s+AS[\s\S]{0,600}?\)\s*STORED\b/gi)) {
      offenders.push(`${file}: ${m[0].slice(0, 60)}…`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no MariaDB-only IF [NOT] EXISTS forms in column/index DDL (invalid on MySQL 8)', () => {
  const offenders = [];
  const re = /\b(?:DROP\s+(?:COLUMN|INDEX)\s+IF\s+EXISTS|ADD\s+(?:COLUMN|INDEX)\s+IF\s+NOT\s+EXISTS)\b/gi;
  for (const file of migrationFiles) {
    const code = readFileSync(join(backendDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line)) // comments may mention the syntax
      .join('\n');
    for (const m of code.matchAll(re)) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('every script in the db:migrate chain exists', () => {
  const pkg = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
  const scripts = [...pkg.scripts['db:migrate'].matchAll(/node\s+(\S+\.js)/g)].map((m) => m[1]);
  assert.ok(scripts.length > 20, `parsed ${scripts.length} scripts`);
  const missing = scripts.filter((s) => !existsSync(join(backendDir, s)));
  assert.deepEqual(missing, []);
});

test('migrateMarketplace only indexes tables that exist by the time it runs (fresh install == upgraded schema)', () => {
  // M-4 / VAL-4: it listed financial_events and scheduler_job_status, which
  // later migrations create. A fresh install logged "Could not add" and
  // skipped them; a second run added duplicates of the creators' own indexes,
  // so fresh and upgraded databases ended up with different schemas.
  const pkg = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
  const chain = ['setupDB.js', ...[...pkg.scripts['db:migrate'].matchAll(/node\s+(\S+\.js)/g)].map((m) => m[1])];
  const baseSql = readFileSync(join(backendDir, '..', 'branding_house.sql'), 'utf8');
  const creates = (src, table) => new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?\`?${table}\`?[\\s(]`, 'i').test(src);
  const source = (file) => (file === 'setupDB.js' ? baseSql : readFileSync(join(backendDir, file), 'utf8'));
  // Tables whose creation is guarded by tableExists() + a bare CREATE TABLE count too.
  const creatorIndex = (table) => chain.findIndex((file) => creates(source(file), table));

  const src = readFileSync(join(backendDir, 'migrateMarketplace.js'), 'utf8');
  const block = src.match(/const wantedIndexes = \[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'wantedIndexes list found');
  const tables = [...block[1].matchAll(/^\s*\['(\w+)'/gm)].map((m) => m[1]);
  assert.ok(tables.length > 5, `parsed ${tables.length} entries`);
  const self = chain.indexOf('migrateMarketplace.js');
  const late = [...new Set(tables)]
    .map((t) => ({ t, at: creatorIndex(t) }))
    .filter(({ at }) => at === -1 || at > self)
    .map(({ t, at }) => `${t} (created by ${at === -1 ? 'nothing in the chain' : chain[at]})`);
  assert.deepEqual(late, []);
});
