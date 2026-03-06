/**
 * GOZI Cron Server
 * Deploy pe Railway / Render / VPS cu:
 *   npm install && node scripts/cron.js
 *
 * Environment variables necesare:
 *   SUPABASE_URL          — din Supabase dashboard → Settings → API
 *   SUPABASE_SERVICE_KEY  — service_role key (nu anon key!)
 */

require('dotenv').config();
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

// ── Validare config ────────────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Lipsesc SUPABASE_URL sau SUPABASE_SERVICE_KEY din .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helper: log cu timestamp ───────────────────────────────────────
function log(label, result) {
  const ts = new Date().toISOString();
  if (result?.error) {
    console.error(`[${ts}] ❌ ${label}: ${result.error.message}`);
  } else {
    console.log(`[${ts}] ✅ ${label}${result?.data != null ? ': ' + JSON.stringify(result.data) : ''}`);
  }
}

// ── Job 1: Actualizează heat scores City Pulse (la 30 min) ─────────
cron.schedule('*/30 * * * *', async () => {
  const result = await supabase.rpc('update_all_venue_heat');
  log('update_all_venue_heat', result);
});

// ── Job 2: Cleanup prezențe vechi >48h (zilnic la 03:00) ───────────
cron.schedule('0 3 * * *', async () => {
  const result = await supabase.rpc('cleanup_old_presence');
  log('cleanup_old_presence', result);
});

// ── Job 3: Health check — verifică că DB-ul e accesibil (la 1h) ───
cron.schedule('0 * * * *', async () => {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`[${new Date().toISOString()}] ❌ Health check: ${error.message}`);
  } else {
    console.log(`[${new Date().toISOString()}] 💓 Health check OK — ${count} events în DB`);
  }
});

// ── Job 4: Placeholder scraper iaBilet (zilnic la 06:00) ──────────
// TODO: Activează când scraper-ul e deploiat
// cron.schedule('0 6 * * *', async () => {
//   const result = await fetch('https://your-scraper.railway.app/scrape/iabilet');
//   log('scraper iaBilet', { data: await result.text() });
// });

// ── Pornire ────────────────────────────────────────────────────────
console.log(`[${new Date().toISOString()}] 🚀 GOZI Cron Server pornit`);
console.log('  • La 30 min: update_all_venue_heat()');
console.log('  • La 03:00 zilnic: cleanup_old_presence()');
console.log('  • La fiecare oră: health check DB');

// Rulează imediat la start pentru prima populare a cache-ului
(async () => {
  console.log(`[${new Date().toISOString()}] ⚡ Rulăm update inițial heat...`);
  const result = await supabase.rpc('update_all_venue_heat');
  log('update_all_venue_heat (start)', result);
})();
