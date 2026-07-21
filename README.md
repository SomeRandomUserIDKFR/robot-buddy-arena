# Robot Buddy Arena

A dependency-free HTML5 Canvas prototype about training an AI partner, then fighting alongside it.

## Run

From this folder run `npm run serve` (or `dev.cmd` / `dev.ps1` on Windows), then open
<http://localhost:8000>.

`npm run serve` auto-pulls `origin/master` on start and about every 45s while the
server runs (skips if you have local uncommitted changes). Hard-refresh the
browser after a sync log line. Disable with `npm run serve:nosync`.

You can still use `python -m http.server 8000`, but that path does **not** auto-sync.

Chrome, Edge, or Firefox is recommended. **Serve over localhost** rather than
opening `index.html` through `file://`; module imports, the Web Worker analyzer,
and the page CSP (`connect-src 'self'`) require an HTTP origin.

## One-time model vendoring

Post-Training coaching can optionally use a local MiniLM sentence encoder. Assets
are downloaded once into the repo; the game never fetches models at runtime.

```bash
npm run vendor-model
```

This writes:

- `models/all-MiniLM-L6-v2/` — quantized ONNX + tokenizer + Apache-2.0 license
- `vendor/analyzer-runtime.js` — offline Transformers.js browser bundle
- `vendor/ort-wasm/` — ONNX Runtime WebAssembly
- `models/MANIFEST.json` — identity, sizes, and offline contract

If those files are missing, coaching falls back to **Basic understanding active**
with the deterministic hybrid parser. There is no runtime download path.

Optional browser smoke (needs system Chrome/Edge and `puppeteer-core`):

```bash
npm install --no-save puppeteer-core
npm run smoke:analyzer
```

## File layout

- `game.js` — entrypoint and match orchestration
- `config.js` — gameplay constants and AI presets
- `maps.js` — themed arena layouts, props, breakable cover, and power-crate spawn density
- `combat.js` — fighters, movement, weapons, and projectiles
- `powerups.js` — metal power-up crates, buff award/tick, sight-aware spawn/respawn
- `equipment.js` — gear catalog, loadouts, Cyber economy, rewards, purchases, and buddy gear decisions
- `power.js` — unified Power (danger estimate) from gear, perks, and AI / training
- `conquest.js` — Ranking leagues, opponent encounter generation (includes mapId), Power via `power.js`, reroll rules
- `perks.js` — perk catalog, Conquest EXP / levels, unlock picks, and buddy perk autonomy
- `ai.js` — target selection and buddy/trainer decisions
- `learning.js` — training observation and profile updates
- `coaching.js` — constrained coaching language, confirmations, and directive memory
- `game-faq.js` / `knowledge/game-faq.json` — offline game Q&A routing + curated FAQ pack
- `language-analyzer.js` / `language-analyzer-worker.js` — local MiniLM ranking + status UI
- `models/` / `vendor/` — vendored encoder and offline runtime (see above)
- `rendering.js` / `vision.js` — canvas drawing, themed backdrops, and shared sight / LOS rules
- `input.js` — keyboard and mouse state
- `ui.js` / `storage.js` — menus, HUD, results, and persistent profile data
- `utils.js` — shared math and formatting helpers

## Controls

- **A / D** — move
- **W or Space** — jump; hold while airborne to use the jetpack
- **Shift** — jetpack
- **C** — dodge/dash with brief invulnerability
- **Q** — raise/lower equipped shield (blocks frontal attacks; cannot fire while raised). With **Mechanical Modularity** in shield mode, Q raises the modular plate the same way.
- **F** — deploy/retract **Retractable Armor** or **Retractable Shell** (separate armor HP pool; ~10% slower while on; morph style follows Settings → Visual)
- **E** — cycle **Mechanical Modularity** modes (Sword → Shield → Pulse Rifle) with a short morph animation; cannot attack mid-morph
- **Mouse** — aim
- **Left mouse button** — fire gun / swing saber
- **G** — ping the cursor location for your buddy
- **Escape** — pause

## Equipment bay and Shop

The pre-match Equipment tab equips both robots across five slots: main body armor, helmet, weapon, jetpack, and shield. Ten starter items (two per slot, including **No Shield** and **Light Buckler**) are owned for free, and every choice is a tradeoff rather than a straight level upgrade. The adjacent Shop tab has at least four choices per slot, displays effective modifier percentages, and permanently unlocks purchases for either teammate.

Body armor changes integrity, movement speed, and incoming damage. Helmets trade integrity against sensor range. Rifle and saber variants use explicit `gun` or `saber` base mechanics while changing damage, fire/swing rate, reach, and projectile speed; learning therefore continues to use the original gun/saber memory keys. **Mechanical Modularity** is a shop morph weapon: **E** shifts between Sword (Arc Saber stats), a slightly weaker modular shield plate, and a slightly weaker Pulse Rifle; combat and learning ticks use the **active mode’s** gun/saber kind so saves stay compatible. Jetpacks change tank capacity, thrust, and recharge while preserving the same exhaustion lockout and restart-reserve rules.

Shields are a separate slot. Durability is a **per-match block HP pool** that does not recharge mid-match. Press **Q** to raise the shield toward your aim; only attacks arriving inside a forward cone (about ±70–80°) are blocked, and blocking spends durability equal to the damage that would have been dealt. While raised you cannot fire or swing. A depleted shield stays equipped as dead weight: it no longer blocks and applies a stronger ongoing speed penalty until the next match resets the pool.

Option rows show about two cards at once. Scroll them horizontally with a wheel, trackpad, touch drag, the subtle edge arrows, or Left/Right while the row is focused. Browser scrollbars are intentionally hidden, but cards remain focusable and later choices can be selected normally.

Player equipment is always manual. Buddy equipment has three autonomy settings:

- **User Picked** — every buddy slot is editable.
- **AI Suggested** — the buddy proposes only owned gear, gives a deliberately humble evidence-based reason, and lets you accept, reject, or edit the suggestion.
- **AI's Choice** — the buddy equips itself from owned gear using learned range/rush evidence. Buddy cards are locked until the mode changes; attempts do not silently override autonomy.

The equipment profile, both loadouts, autonomy setting, owned item IDs, integer **Cyber** balance, **Conquest Ranking**, **level / EXP**, unlocked perks, equipped perks, and buddy perk autonomy use the existing `robotBuddyArena.v1` save. Cyber is always written as `¢`. New players and old saves without economy data receive **120¢** plus the starter items; a saved 0¢ remains 0¢. Old saves without a ranking field start at **Ranking 100**. Old saves without progression fields start at **level 1 / 0 EXP** with no perks unlocked. Old saves without a shield slot migrate to **No Shield**. Old saves containing only `gun` or `saber` weapon strings migrate to complete starter loadouts without replacing coaching, evidence, vocabulary, or other profile fields.

Cyber is earned only for winning Conquest against an enemy duo: **35¢ Rookie**, **60¢ Veteran**, or **90¢ Elite** (reward tier from your Ranking league). The same win also grants Conquest **EXP** (**40 / 70 / 110** by tier). **Ranking** is a separate Conquest score (display/reward only; does not soft-lock tiers): start at **100**; a win gains `ceil(100 + (rank − 100) × 0.5)`; a loss drops `ceil(25% of that win gain)`, floored at **0**. A match result ID prevents duplicate Cyber/EXP/Ranking awards if completion is invoked again. Training and Spar pay no Cyber, no Conquest EXP, and no Ranking change; defeats remove no Cyber or EXP (Ranking can still drop on Conquest loss).

### Conquest opponent select

Conquest opens an **opponent selection** screen (not an immediate fight). Ranking maps to a **league** that sets AI difficulty and reward tier:

| Ranking | League | AI (trainer / follower) | Cyber/EXP tier |
| --- | --- | --- | --- |
| 0–149 | Rookie | rookie / recruit | Rookie |
| 150–299 | Contender | contender / rookie | Rookie |
| 300–499 | Veteran | veteran / rookie | Veteran |
| 500–749 | Challenger | challenger / veteran | Veteran |
| 750–999 | Elite | elite / veteran | Elite |
| 1000+ | Apex | elite / elite | Elite |

`contender` and `challenger` are mid AI presets between Rookie↔Veteran and Veteran↔Elite. The panel shows Ranking, league, **map name**, trainer + follower names, gear loadouts, training flavor, and **Power** (trainer / follower / duo — same danger formula as Equipment Bay Your/Buddy Power; not HP). **Reroll**: first reroll per visit is free; further rerolls cost **10¢** Cyber (blocked when broke) and roll a new map with the duo. Fight starts with the displayed duo and map (session-only pending encounter — not re-rolled at fight time). Back returns to the equipment bay.

## Maps and breakable cover

Arenas are fixed themed layouts (~3-screen width), not procedural. Training has a **Map** picker (or Random). Conquest assigns a `mapId` on the encounter select screen.

| Map | Layout notes |
| --- | --- |
| **Battlefield** | Classic open combat platforms (original arena). |
| **City** | Tall building stacks / rooftops, alley gaps; solid walls can block LOS. |
| **Desert** | Uneven dune shelves; **cactus** and **dead bush** soft cover. |
| **Forest** | Dark **trees** — fighters walk through trunks; canopies are visual overlay; trunks can still stop bullets until broken. |
| **Yard** | Industrial mid cover — crates, pipes, barrels. |
| **Ruins** | Broken pillars and asymmetric ledges. |
| **Docks** | Long horizontal piers over a pit hazard (gaps between docks). |

**Breakable cover:** props have HP; bullets, sabers, and lasers damage them. Intact soft cover **blocks projectiles**. When destroyed, collision/cover stops and a debris flash plays. Forest trunks are **not solid** for movement and **do not hard-block vision**. Props reset every match.

### Metal power-up crates

Separate from wooden cover crates: metal loot boxes with map-themed overlays (leaves, sand, graffiti, mud/scorch, rust/oil, moss, wet/salt). Break them with any weapon; **the fighter who deals the killing blow** receives the power-up. Unseen crates (fog of war) are not drawn and are not AI targets. Destroyed crates respawn after ~20s, preferring spots neither team can see. Abundance rises with match time; Forest/Yard are denser, City is sparse (max concurrent capped per map).

| Power-up | Effect |
| --- | --- |
| **Fire Rate** | 15s, ×1.35 fire/swing rate (countdown) |
| **Heal** | Instant +50 HP (clamped to max) |
| **Regen** | +50 HP over 15s (countdown) |
| **Counter Slash** | Melee wielders only, 18s: while Q shield raised, a melee *or projectile/laser* hit dashes you at the attacker for one slash (~0.75s between counters; gun users reroll this type) |
| **Speed Surge** | 10s, modest move-speed boost |
| **Shield Patch** | Restore shield durability, or small heal if no shield |
| **Jet Siphon** | Restore a portion of jet fuel |
| **Overcharge** | Next 1–2 shots/swings deal bonus damage |

Timed buffs show circular countdown clocks above the fighter and chips on the HUD.

## Perks and Conquest EXP

Level milestones unlock **perk picks**. Each level-up presents **three random** tradeoffs from the shared perk pool; you permanently unlock **one**. You and your buddy each equip **exactly one** unlocked perk at a time (or none). Perks are mostly tradeoffs — faster move for less HP, more shield durability for slower raised movement, Cyber bonus for taking more damage, and so on — and modifiers apply through the same loadout/stats path as gear.

Buddy **perk** autonomy is separate from gear autonomy, with the same three modes (User Picked / AI Suggested / AI's Choice), restricted to unlocked perks. Your own perk is always user-picked. Enemy trainers do not use player perks.

EXP curve (prototype): level 1→2 needs **100 EXP**, then about **×1.3** per level. Early Conquest wins should reach the first perk within a few matches.

## Jetpack fuel rules

A full tank sustains about **3 seconds** of continuous thrust and recharges from empty in about **5 seconds** while the jet is idle. Running the tank completely dry engages an **exhausted lockout** (the HUD fuel meter turns red and reads `EXHAUSTED`): thrust is disabled, and it only re-arms after the thrust input (Shift, and W/Space, which also thrust while airborne) has been fully **released** and fuel has rebuilt to a **20% restart reserve** (~1 second of forced downtime). Holding the key keeps recharging fuel but never reactivates thrust on its own, and rapid tapping cannot shortcut the reserve. The same rules apply to the player, the buddy, and enemy AIs; AIs release the jet while locked out and retry once the reserve is back. Partial burns that never hit empty are unaffected — you can feather the jet freely as long as you don't run dry.

The arena also has a hard ceiling just above the highest platform's airspace (`y = 12` world units, marked by the red boundary line). Fighters clamp against it and projectiles that leave the world bounds are removed. `node jetpack-sim.mjs` (also part of `npm test`) verifies all of these rules against the real physics code.

## How learning works

Learning is evidence-based and multidimensional. There is no level, skill percentage, elapsed-time ramp, or automatic per-match learning reward. Starting or finishing a match changes no learning record by itself; idle play also produces no evidence. A record changes only when a relevant situation occurs, the buddy makes a prediction or attempts a counter, and the result can be judged.

**Learning Lock / Spar only** (equipment bay toggle, persisted on the profile, default unlocked): Training still runs as a full 1v1 with the same controls, mind modes, Mimic, and gear, but the match writes no habit evidence, capability evidence (including precisionAim), readiness changes, coaching directive practice tallies, lesson proposals, or other Training learning updates. Post-match feedback makes the spar clear — no “I learned…” claims. Coaching chat and new practice goals remain available after a spar; that spar itself does not advance practice evidence. Conquest Cyber, EXP, and Ranking rewards are unaffected; lock only means Training will not write learning. Training / Spar never grant Conquest EXP or Ranking changes.

The gun and saber profiles independently track engagement-range prediction, rush prediction, dodge-timing prediction, jetpack-use prediction, and low-HP behavior. Aim, useful dodge timing, and fuel management have separate outcome records too. Each record stores successes, failures, an outcome-weighted estimate, and uncertainty. Contradictory outcomes lower reliability, so a changed player habit can make an old belief stale. Learning rush timing cannot improve aim, fuel use, or any other unrelated domain.

Readiness keeps the text states “I'm not ready yet.”, “Am I ready?”, and “I'm ready.”, but derives them from relevant sample sufficiency, demonstrated reliability, and uncertainty. The menu and match analysis also say what is ready or lacks evidence. The overall result is conservative: one well-practiced habit does not imply broad readiness.

Flash, Balanced, and Thinker set mind ceilings for reaction tempo, aim turn rate, and risk style. An untrained buddy starts clearly rookie (Flash still snappier than Thinker, but far from trained Flash); evidence earns anticipation and decisions up toward those ceilings. **Mimic** is a fourth mind that unlocks from readiness and tries to *copy* your learned style (range, rush, dodge, jet, low-HP aggression) with an intensity dial (Slight ≈25% / Quite a bit ≈55% / Full ≈85%). In Conquest, a soft teammate-safety blend (~28%) still limits mirror-suicide. Enemy Trainer and Follower AI come from the Ranking league on the Conquest select screen (including Contender / Challenger mid presets).

After every Training match, the results screen includes a persistent conversation with the buddy. Its first message cites a recorded match statistic and proposes a concrete lesson. Natural free text is the primary input; quick replies and topic chips are optional. Coaching recognizes varied wording, simple conditions, negation, direction, typos, and compatible compound requests for rushing, retreating, following, covering from range, conserving or using jetpack fuel, dodging, flanking/scouting, and focusing pings or targets. Typed approval and denial resolve the current interpretation or proposal.

After Conquest, the same panel stays open for **game Q&A only** (no new practice goals). Topic chips cover Controls, Learning, Vision, Shop, and Jetpack.

### Game Q&A (local FAQ)

Player messages are routed before coaching:

1. Detect **question about the game** vs **coaching command** (ambiguous lines ask which you meant).
2. Questions match a curated in-repo FAQ (`knowledge/game-faq.json`) via keyword overlap, with MiniLM cosine ranking when the worker is ready.
3. Replies use the humble template composer; MiniLM never free-generates answers or invents mechanics.
4. Low confidence admits unknown and suggests rephrasing or topic prompts.
5. Coaching commands still use the hybrid intent pipeline (directives, confirmation, practice gates).

The FAQ covers controls, Training vs Conquest, Conquest leagues / opponent select / reroll / maps, themed arenas and breakable cover, learning lock / spar-only Training, learning/readiness/coaching, mind modes (including Mimic), fog/shared vision/arrows/buddy outline, jetpack fuel/lockout/ceiling, equipment/shop/Cyber, Conquest Ranking, shields, weapon families, team-wipe wins, and offline analyzer status.

### Local language analyzer (MiniLM)

When vendored assets are present, a Web Worker loads **`sentence-transformers/all-MiniLM-L6-v2`**
(ONNX port `Xenova/all-MiniLM-L6-v2`, quantized `onnx/model_quantized.onnx`, Apache-2.0)
and ranks player text against closed-set intent exemplars **and** FAQ question prototypes via cosine similarity.

Hybrid scoring:

1. Deterministic phrase/typo/clause/negation/condition scoring always runs.
2. MiniLM similarities blend into intent totals when the worker is ready.
3. Deterministic guards re-apply after the blend, so negation, contrast, approval,
   denial, confirmation, conflicts, and safety stay authoritative.
4. FAQ answers come only from curated local entries; the model never controls combat,
   progression, rewards, equipment, or freeform dialogue.

Status near the coaching input:

- `Loading local analyzer…` while the worker starts (typing still works)
- `Local language analyzer ready · Q&A ready` when MiniLM ranking is active and the FAQ pack loaded
- `Basic understanding active · Q&A keywords` when the FAQ pack is present without the model
- `Basic understanding active` if assets are missing or load fails

### Offline guarantee

- `env.allowRemoteModels = false`, local `models/` path only, local ORT WASM path
- CSP `connect-src 'self'` / `worker-src 'self'`
- Fetch interception in tests and smoke fails on Hugging Face / CDN / mirror URLs
- Missing assets → basic parser + keyword FAQ; **no** runtime download attempt
- FAQ JSON lives under `knowledge/` and is never fetched remotely

`coaching.test.js` includes 47 evaluation utterances (100% in the current suite)
covering intermediate English, paraphrases, typos, negation, contrast, conditions,
compound requests, approval/denial, and ambiguity, plus hybrid semantic-assist cases.
The suite requires at least 85% structured accuracy. `game-faq.test.js` covers
question-vs-coaching routing and FAQ topic matches. `npm run smoke:analyzer`
verifies load + first inference + a sample Q&A turn with zero remote fetches.

The original `robotBuddyArena.v1` browser `localStorage` key is retained. Old duration, match-count, percentage, and competence-style values are never converted into evidence. Useful old habit summaries are retained as `legacyHabits` context, conversations and vocabulary are preserved, and all new evidence records start conservatively empty. Clearing this site's browser storage resets the profile.
