import { describe, expect, it } from 'vitest';
import { getSql } from './db.js';
import { applyIncrementalMigrations, migrate } from './schema.js';

/**
 * The sequence payload columns are additive: a database written before they existed must keep
 * its in-flight sequence row and gain the columns at their defaults.
 *
 * `offer_disposition` back-fills to 'accepted' for one reason only — a pre-migration row exists
 * at all, and a row is created only when the user explicitly sent. Rows were never created for
 * offers that were declined, because there was nothing to hold the reason until this column.
 */
describe('pending-sequences — schema migration (addIfMissing)', () => {
  it('adds the payload columns to a sequence table that lacks them, without losing the row', async () => {
    const SQL = await getSql();
    const db = new SQL.Database();
    migrate(db);

    // Simulate a pre-payload database: rebuild the table with the original ten columns only.
    db.run(`
      CREATE TABLE pending_prompt_sequences_old AS
        SELECT id, project_root, session_id, sequence_id, enhancement_id, item_count,
               current_item_index, status, last_action_id, created_at, updated_at
        FROM pending_prompt_sequences;
      DROP TABLE pending_prompt_sequences;
      ALTER TABLE pending_prompt_sequences_old RENAME TO pending_prompt_sequences;
    `);
    db.run(
      `INSERT INTO pending_prompt_sequences
         (project_root, session_id, sequence_id, enhancement_id, item_count, current_item_index,
          status, last_action_id, created_at, updated_at)
       VALUES ('/p', 's', 'seq-old', 'enh-old', 3, 1, 'item_pending', NULL, 1, 1)`,
    );

    const before = (db.exec('PRAGMA table_info(pending_prompt_sequences)')[0]?.values ?? [])
      .map((r) => r[1] as string);
    expect(before).not.toContain('items_json');

    applyIncrementalMigrations(db);

    const after = (db.exec('PRAGMA table_info(pending_prompt_sequences)')[0]?.values ?? [])
      .map((r) => r[1] as string);
    for (const column of [
      'items_json',
      'prompt_directives_json',
      'suggested_next_prompt_policy',
      'original_length',
      'offer_disposition',
    ]) {
      expect(after).toContain(column);
    }

    // The in-flight row survives and reads at the documented defaults.
    const row = db.exec(
      `SELECT sequence_id, items_json, prompt_directives_json, suggested_next_prompt_policy,
              original_length, offer_disposition
       FROM pending_prompt_sequences`,
    )[0]?.values[0];
    expect(row).toEqual(['seq-old', '[]', '[]', 'not_generated', 0, 'accepted']);

    // Idempotent: running it again is a no-op rather than an error.
    applyIncrementalMigrations(db);
    expect(db.exec('SELECT COUNT(*) FROM pending_prompt_sequences')[0]?.values[0][0]).toBe(1);
    db.close();
  });
});
