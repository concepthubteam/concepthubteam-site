# GOZI — Document de Audit Tehnic
**Data auditului:** 2026-03-05
**Versiune app:** 1.0.0
**Auditat de:** Claude (Anthropic) + Remus Enus

---

## 1. OVERVIEW

**GOZI** este o aplicație mobilă React Native (Expo) pentru descoperirea evenimentelor din București. Agregă date din multiple surse (iaBilet, Resident Advisor, TikTok), le stochează în Supabase și le servește utilizatorilor cu filtrare, hartă interactivă și notificări.

| Atribut | Valoare |
|---------|---------|
| Platform | iOS + Android (React Native / Expo SDK 54) |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| Build system | EAS (Expo Application Services) |
| Bundle ID | `com.gozi.app` |
| EAS Owner | `gozi_bucuresti` |
| Ultima APK | build ID `c14a93f3` (2026-03-05) |

---

## 2. ARHITECTURĂ

```
┌─────────────────────────────────────────────────┐
│                   EXPO GO / APK                  │
│                                                  │
│  App.js                                          │
│    └── ErrorBoundary                             │
│         └── AuthProvider                         │
│              └── EventsProvider (normalizeEvent) │
│                   └── SavedProvider              │
│                        └── AppNavigator          │
│                             ├── Stack Navigator  │
│                             └── Tab Navigator    │
│                                  ├── HomeScreen  │
│                                  ├── ExploreScreen│
│                                  ├── MapScreen   │
│                                  ├── SavedScreen │
│                                  └── ProfileScreen│
└─────────────────────────────────────────────────┘
          │                         │
          ▼                         ▼
   Supabase DB               AsyncStorage
   (events, users,           (saved_ids,
    user_saved,               history,
    venues, signals)          onboarding)
```

---

## 3. STACK TEHNOLOGIC

### Frontend
| Librărie | Versiune | Rol |
|----------|---------|-----|
| expo | ~54.0.0 | Runtime principal |
| react-native | 0.81.5 | UI framework |
| @react-navigation/native | ^6.1.9 | Navigare |
| @react-navigation/bottom-tabs | ^6.5.11 | Tab bar |
| react-native-maps | 1.20.1 | Hartă interactivă |
| expo-location | ~19.0.8 | GPS locație utilizator |
| expo-notifications | ~0.32.16 | Push notifications + remindere |
| expo-linear-gradient | ~15.0.8 | Gradienți UI |
| @expo/vector-icons | ^15.0.3 | Iconuri Ionicons |
| expo-font | ~14.0.11 | Custom fonts |

### Backend
| Serviciu | Rol |
|----------|-----|
| Supabase (PostgreSQL) | DB principal, Auth, Realtime |
| Supabase Auth | Email/password auth |
| Supabase Realtime | Live updates evenimente |
| Google Maps API | Hărți native (iOS + Android) |
| EAS Build | CI/CD builds cloud |

---

## 4. ECRANE ȘI FUNCȚIONALITĂȚI

### 4.1 HomeScreen
- Afișează evenimente filtrate după: **Azi / Mâine / Weekend / Săptămâna**
- Filtru **Gratuit** dedicat
- Secțiune **Recomandate** (featured events)
- Secțiune **Deschis Acum** (locuri permanente, dateISO: null)
- Sortare **după distanță** (GPS)
- **Magic Button** „Ce fac azi?" — algoritm scoring: featured×3 + rating×2 + gratuit×1 + boost orar + distanță
- Search full-text în titlu și venue

### 4.2 ExploreScreen
- Browse pe categorii: Events, Restaurants, Clubs, Kids, Parks, Cinema, Sport, Theatre
- Browse pe tag-uri (frecvență)
- Istoric vizualizări recente (AsyncStorage)
- Filtrare Gratuit

### 4.3 MapScreen
- MapView (Apple Maps în Expo Go, Google Maps în APK standalone)
- Markere colorate per categorie cu emoji
- Filter date + categorie pe hartă
- Popup preview la click marker → navigare la EventDetail
- Recenter pe locația utilizatorului (GPS)

### 4.4 SavedScreen
- Lista evenimentelor salvate (badge cu număr în tab bar)
- Stare persistată local (AsyncStorage) + cloud (Supabase `user_saved`) cu merge la login

### 4.5 ProfileScreen
- Login / Register cu email + parolă
- Afișare user logged in + logout
- Statistici: saved count, vizualizări recente

### 4.6 EventDetailScreen
- Hero image 280px cu gradient overlay
- Grid 2×2 cu: dată, oră, preț, locație
- Descriere + tags
- Buton „Deschide în Maps" (Google Maps URL scheme)
- Links: Website, Telefon, Instagram, Bilete online
- Buton reminder (notificare cu 1h înainte)
- Buton save/unsave
- Share event (deep link `gozi://event/:id`)
- Secțiune „Similar events" (același category)

### 4.7 Alte ecrane
- **OnboardingScreen** — afișat o singură dată la prima instalare
- **AuthScreen** — login/register flow
- **SubmitEventScreen** — utilizatorii pot propune evenimente noi (salvate în `event_submissions`)
- **TikTokInboxScreen** — interfață admin pentru review signals extrase din TikTok

---

## 5. DATE ȘI BAZA DE DATE

### Schema Supabase (13 tabele)

```
events            — evenimentele principale (407 din scrapers)
venues            — locații (cu coordonate GPS)
source_events     — log proveniență (iaBilet, RA.co)
user_saved        — favorite utilizatori (RLS: user vede doar al său)
event_submissions — propuneri utilizatori (pending/approved/rejected)
tiktok_accounts   — 9 conturi urmărite (cluburi, promoteri)
tiktok_videos     — videos colectate
signals           — date extrase din caption/hashtags TikTok
tiktok_runs       — audit log jobs scraper
```

### Surse de date
| Sursă | Tip | Frecvență | Volume |
|-------|-----|-----------|--------|
| iaBilet.ro | Scraper (Apify/Python) | Zilnic | ~360 events |
| Resident Advisor | Scraper | Zilnic | ~47 events |
| TikTok (9 conturi) | Apify Actor | Configurat dar neutilizat activ | - |
| Utilizatori | Form submit | La cerere | - |

### Normalizare date
Funcția `normalizeEvent()` în `EventsContext.js` traduce automat:
- `date_iso` → `dateISO`
- `tickets_url` / `ticket_url` → `ticketsUrl`
- `image_url` → `image`
- `category_label` → `categoryLabel`
- `tags: null` → `tags: []`
- `price: null` → `price: 'N/A'`
- `lat/lng: string` → `Number` cu fallback București (44.4368, 26.0976)

---

## 6. SECURITATE

### ✅ Ce funcționează bine
- **RLS (Row Level Security)** activat pe toate tabelele sensibile
- `user_saved`: utilizatorul vede/modifică DOAR propriile înregistrări
- `event_submissions`: INSERT public, SELECT doar pentru owner
- `tiktok_*` / `signals`: acces ZERO din client (doar service_role)
- **Anon key** în env vars (`EXPO_PUBLIC_*`), nu hardcodat în cod
- **Session persistată** cu AsyncStorage + auto-refresh token
- **ErrorBoundary** la nivel de app previne crash-uri neașteptate

### ⚠️ Observații
- Google Maps API Key este în `app.json` (vizibil în build — standard pentru React Native, cheia trebuie restricționată în GCP pe bundle ID)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` este public prin design Supabase — OK, RLS protejează datele
- Anon key vizibil în `eas.json` — fișier local, nu în repository public

---

## 7. PERFORMANȚĂ

### Strategii de caching
- Mock data fallback instant la pornire (0 latency)
- Supabase realtime subscription pentru live updates
- `AsyncStorage` pentru saved IDs și historicul vizualizărilor
- Skeleton loaders (650ms delay artificial) pentru UX fluid

### Observații
- 407 events încărcate odată cu `SELECT *` — la >1000 events va fi nevoie de paginare
- Imaginile nu au lazy loading explicit (React Native le gestionează intern)
- Niciun query cache explicit (Supabase clientul nu are built-in cache)

---

## 8. NOTIFICĂRI

- **Permisiune** cerută la prima setare reminder
- **Reminder cu 1h înainte** de eveniment (calculat din `dateISO` + `time`)
- Dacă data e în trecut → notificare test în 5 secunde (dev friendly)
- Identificator unic per eveniment: `gozi_event_<id>`
- Funcționează pe device fizic; simulatoarele nu suportă

---

## 9. DEEP LINKING

Schema: `gozi://event/:eventId`

Configurat în `NavigationContainer` cu `linking` config:
```
gozi://home       → HomeScreen
gozi://explore    → ExploreScreen
gozi://map        → MapScreen
gozi://saved      → SavedScreen
gozi://profile    → ProfileScreen
gozi://event/123  → EventDetailScreen (eventId=123)
```

---

## 10. STAREA ACTUALĂ — AUDIT (2026-03-05)

### ✅ Funcțional
- [x] App compilat și rulează pe Android (APK `c14a93f3`)
- [x] Expo Go funcționează via `--tunnel`
- [x] Supabase conectat cu 407 events reale
- [x] 9 conturi TikTok configurate în DB
- [x] Google Maps key setat (funcțional în APK, nu în Expo Go)
- [x] Auth: login/register/logout cu email
- [x] Saved events: local + cloud sync
- [x] Remindere push notifications
- [x] Deep linking configurat
- [x] Onboarding flow

### ⚠️ Limitări cunoscute
- [ ] Harta nu funcționează în **Expo Go** (Google Maps necesită build nativ)
- [ ] Nu există **paginare** pentru events (toată lista la un request)
- [ ] **TikTok scraping activ** nu rulează automat (necesită cron job)
- [ ] **iOS build** necesită Apple Developer Program ($99/an)
- [ ] `categoryLabel` și `timeEnd` nu sunt populate din scrapers (câmpuri opționale)

### 🔧 Buguri rezolvate în acest audit
- `event.tags.map()` crash când `tags: null` din DB → fixed cu `normalizeEvent()`
- `event.price.split()` crash când `price: null` → fixed
- `event.dateISO` undefined din DB (snake_case) → fixed, filtrele funcționează corect

---

## 11. STRUCTURA FIȘIERE

```
gozi-app/
├── App.js                    # Entry point, providers, onboarding check
├── index.js                  # Expo entry
├── app.json                  # Config Expo (bundle ID, Maps key, plugins)
├── eas.json                  # EAS build profiles (dev/preview/production)
├── src/
│   ├── components/
│   │   ├── CategoryGrid.js   # Grid categorii cu imagini
│   │   ├── ErrorBoundary.js  # Catch all React errors
│   │   ├── EventCard.js      # Card eveniment (featured + list variant)
│   │   ├── FilterTabs.js     # Tab-uri filtru dată
│   │   └── SkeletonCard.js   # Loading placeholders
│   ├── constants/
│   │   └── colors.js         # Design system: culori, COLORS.cat[], accent
│   ├── context/
│   │   ├── AuthContext.js    # Supabase auth state
│   │   ├── EventsContext.js  # Events fetch + normalizeEvent()
│   │   └── SavedContext.js   # Saved IDs (local + cloud merge)
│   ├── data/
│   │   └── mockData.js       # Fallback data + CATEGORIES + FILTERS
│   ├── lib/
│   │   └── supabase.js       # Supabase client + isConfigured flag
│   ├── navigation/
│   │   └── AppNavigator.js   # Stack + Tab navigators + deep link config
│   ├── screens/
│   │   ├── HomeScreen.js     # Main feed cu Magic Button
│   │   ├── ExploreScreen.js  # Categorii + tags + search
│   │   ├── MapScreen.js      # Hartă + markere + filter
│   │   ├── SavedScreen.js    # Favorite
│   │   ├── ProfileScreen.js  # Auth + profil utilizator
│   │   ├── EventDetailScreen.js  # Pagina completă eveniment
│   │   ├── OnboardingScreen.js   # Intro la prima deschidere
│   │   ├── AuthScreen.js         # Login/register UI
│   │   ├── SubmitEventScreen.js  # Propune eveniment
│   │   └── TikTokInboxScreen.js  # Admin: review signals TikTok
│   └── utils/
│       ├── filterUtils.js    # matchesFilter() cu date locale
│       └── notifications.js  # Schedule/cancel remindere
└── supabase/
    ├── schema.sql            # Schema originală
    ├── schema_v2.sql         # Migrare: venues, source_events, extend events
    ├── schema_tiktok.sql     # TikTok integration tables
    ├── run_sql.py            # Script rulare SQL în Supabase
    └── seed.js               # Seed date inițiale
```

---

## 12. COMENZI UTILE

```bash
# Rulează app în Expo Go (cu tunnel pentru orice rețea)
npx expo start --tunnel

# Build APK Android
eas build --platform android --profile preview

# Build APK + iOS simulator
eas build --platform all --profile development

# Rulează scrapers (iaBilet + RA.co)
python3 supabase/run_daily.py --scrapers-only

# Check status build
eas build:list --limit 5
```

---

*Document generat automat la 2026-03-05. Actualizare necesară după fiecare sprint major.*
