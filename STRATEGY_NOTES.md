# GOZI — Strategy Audit
**Data:** 2026-03-06
**Sursă:** `gozi_strategy_plan.docx`

---

## Viziune
Transformă GOZI din "event listing app" în "city decision engine".
Întrebarea cheie: **"Ce facem diseară?"** — răspuns în <10 secunde.

---

## ✅ Deja implementat

| Feature (din strategie) | Implementat ca |
|---|---|
| Surprise Me | Magic Button „Ce fac azi?" — 3 sugestii + shuffle |
| Tonight in Bucharest | Filtrul Azi + secțiunea Recomandate |
| Nearby Events | Sortare după distanță GPS |
| Push notifications | Remindere cu 1h înainte |
| Social sharing | Buton Share cu deep link `gozi://event/:id` |
| Data pipeline | Scrapers: iaBilet, RA, ZilesiNopti, IESIM, Eventbook |

---

## ✅ Prioritate 1 — IMPLEMENTAT (2026-03-06)

### A. Hero „Diseară în București" ✅
Secțiune nouă în top HomeScreen: 3 events de AZI care încep în <3 ore.

```js
const todayISO = new Date().toISOString().split('T')[0];
const nowHour = new Date().getHours();
const tonightEvents = events
  .filter(e => e.dateISO === todayISO && e.time)
  .filter(e => {
    const h = parseInt(e.time.split(':')[0]);
    return h >= nowHour && h <= nowHour + 3;
  })
  .slice(0, 3);
```

### B. Strip „Lângă tine" ✅
Afișat când GPS e activ. Events <2km, scroll orizontal.

```js
const nearbyEvents = allEvents
  .filter(e => userLocation &&
    getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng) < 2
  )
  .slice(0, 5);
```

---

## 🟡 Prioritate 2 — Backend necesar (~2-3 zile)

### C. Social proof „X persoane interesate"
Query Supabase pentru count save-uri per event:
```sql
SELECT event_id, count(*) as saved_count
FROM user_saved
GROUP BY event_id;
```
Adaugă `saved_count` la `normalizeEvent()` și afișează în EventCard.

### D. Click tracking bilete
1. Adaugă coloana în Supabase: `ALTER TABLE events ADD COLUMN ticket_clicks INT DEFAULT 0;`
2. Increment la tap pe butonul de bilete (EventDetailScreen):
```js
await supabase.from('events').update({ ticket_clicks: event.ticket_clicks + 1 }).eq('id', event.id);
```
3. Folosește în heat_score: `saves*2 + ticket_clicks*3`

---

## 🟡 Prioritate 3 — Infrastructure (~3-5 zile)

### E. Paginare evenimente
La 1000+ events, `SELECT *` devine lent. Adaugă în EventsContext:
```js
.select('*').range(0, 49).order('date_iso', { ascending: true, nullsFirst: false })
```
Cu load-more la scroll.

### F. Cron job scrapers
Deployment pe server (Railway / Render / VPS):
```
0 8 * * * python3 run_daily.py --scrapers-only
```
Target: 1000+ events active în DB.

---

## 🔴 Faza 3-4 (luna 2+)

| Feature | Blocaj principal |
|---|---|
| heat_score complet | Necesită ticket_clicks tracking (punct D) |
| TikTok pipeline activ | Necesită Apify API key + cron deployment |
| City heatmap | Arhitectură diferită — date densitate, nu pins |
| AI recommendations | Necesită 2-3 săptămâni behavior data |
| Group planning | Feature complet nou |
| Venue dashboards | Produs B2B separat |

---

## Scoring actual (Magic Button)
```
score = (featured ? 3 : 0)
      + (rating >= 4.5 ? 2 : rating >= 4.0 ? 1 : 0)
      + (price === 'Gratuit' ? 1 : 0)
      + getTimeBoost(category)   // 0-3 pts per time of day
      + getDistanceBoost(event)  // 0-2 pts per proximity
      + random() * 1.5           // noise redus
```

## Scoring propus (heat_score din strategie)
```
heat_score = saves * 2 + ticket_clicks * 3 + tiktok_mentions + proximity_pts
```
Necesită implementarea punctelor C + D de mai sus.
