/**
 * Backfill Embeddings Script — Sprint 25
 *
 * Generates embeddings for all memory_entries that don't have one yet.
 * Usage: npx tsx backend/scripts/backfill-embeddings.ts
 *
 * Features:
 * - Rate limiting: max 10 requests/second to avoid API limits
 * - Resume support: skips entries that already have embeddings
 * - Progress logging: every 10 entries
 * - Error handling: continues on individual failures
 */

import { query } from "../src/db/connection.js";
import { getEmbedding } from "../src/services/embedding.js";

const BATCH_SIZE = 10;
const RATE_LIMIT_MS = 100; // 10 req/sec

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("🔍 Fetching memory entries without embeddings...");

  const result = await query(
    `SELECT id, content FROM memory_entries WHERE embedding IS NULL ORDER BY created_at DESC`
  );

  const entries = result.rows;
  console.log(`📊 Found ${entries.length} entries to process`);

  if (entries.length === 0) {
    console.log("✅ Nothing to do — all entries have embeddings");
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const { id, content } = entries[i];

    try {
      const embedding = await getEmbedding(content);

      if (embedding) {
        const vectorStr = `[${embedding.join(",")}]`;
        await query(
          `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
          [vectorStr, id]
        );
        succeeded++;
      } else {
        console.log(`⚠️  Skipped ${id}: embedding service returned null`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ Failed ${id}:`, err instanceof Error ? err.message : String(err));
      failed++;
    }

    processed++;

    if (processed % 10 === 0) {
      console.log(`⏳ Progress: ${processed}/${entries.length} (${succeeded} OK, ${failed} failed)`);
    }

    // Rate limiting
    if (i < entries.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log("\n✅ Backfill complete!");
  console.log(`   Total: ${processed}`);
  console.log(`   Succeeded: ${succeeded}`);
  console.log(`   Failed: ${failed}`);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
