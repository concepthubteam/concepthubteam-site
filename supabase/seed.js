/**
 * GOZI — Supabase seed script
 * Inserează toate evenimentele din mockData în Supabase.
 *
 * Setup:
 *   1. cp .env.example .env  (în rădăcina proiectului)
 *   2. Completați EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY și SUPABASE_SERVICE_ROLE_KEY
 *   3. node supabase/seed.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { EVENTS } from '../src/data/mockData.js';

const SUPABASE_URL        = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Lipsesc variabilele din .env:');
  console.error('   EXPO_PUBLIC_SUPABASE_URL =', SUPABASE_URL || 'LIPSĂ');
  console.error('   SUPABASE_SERVICE_ROLE_KEY =', SUPABASE_SERVICE_KEY ? '***' : 'LIPSĂ');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function toRow(e) {
  return {
    id:             e.id,
    title:          e.title,
    category:       e.category,
    category_label: e.categoryLabel,
    date:           e.date           || null,
    date_iso:       e.dateISO        || null,
    time:           e.time           || null,
    time_end:       e.timeEnd        || null,
    venue:          e.venue          || null,
    address:        e.address        || null,
    price:          e.price          || 'Gratuit',
    rating:         e.rating         || 4.0,
    distance:       e.distance       || null,
    description:    e.description    || null,
    lat:            e.lat            || null,
    lng:            e.lng            || null,
    featured:       e.featured       || false,
    tags:           e.tags           || [],
    website:        e.website        || null,
    phone:          e.phone          || null,
    tickets_url:    e.ticketsUrl     || null,
    instagram:      e.instagram      || null,
    image:          e.image          || null,
  };
}

async function seed() {
  const rows = EVENTS.map(toRow);
  console.log(`🌱  Seeding ${rows.length} events în Supabase...`);

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('events')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`❌  Batch ${Math.floor(i / BATCH) + 1} error:`, error.message);
      process.exit(1);
    }
    console.log(`   ✅  ${i + 1}–${Math.min(i + BATCH, rows.length)} events OK`);
  }

  console.log('🎉  Seed complet!');
}

seed();
