import { resetDatabase } from '../db';

async function main() {
  console.log('[Script] Starting database reset...');
  await resetDatabase();
  console.log('[Script] Database reset complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Script] Database reset failed:', err);
  process.exit(1);
});
