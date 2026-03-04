# GOZI App — Claude Code Instructions

## Project Type
**React Native / Expo SDK 54** — NOT a web app.

## Preview / Dev Server
This project runs via **Expo Go** on a physical device or iOS Simulator.
- `preview_start` cannot launch Expo — it uses a Python HTTP proxy incompatible with Metro bundler
- Verification is done via **static analysis** (brace balance, import checks, grep)
- To run: `cd ~/Desktop/gozi-app && npx expo start --clear`

## Verification after edits
```bash
node -e "
const fs=require('fs');
['App.js','src/screens/HomeScreen.js','src/screens/ExploreScreen.js',
 'src/screens/MapScreen.js','src/screens/SavedScreen.js',
 'src/screens/ProfileScreen.js','src/screens/OnboardingScreen.js',
 'src/utils/filterUtils.js','src/data/mockData.js'].forEach(f=>{
  const s=fs.readFileSync(f,'utf8');
  let d=0; for(const c of s){if(c==='{')d++;if(c==='}')d--;}
  console.log(d===0?'OK:':'ERR:',f);
});
"
```

## Key Rules
- `matchesFilter` lives in `src/utils/filterUtils.js` — NEVER move back to HomeScreen (circular dep)
- AsyncStorage key: `@gozi:onboarded` (not `@gozi:onboarding`)
- `const LOGO = require(...)` must come AFTER all `import` statements
- All imports must be before any executable code
