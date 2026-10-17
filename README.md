# Racing Track Builder (MVP)

Draw a road, place numbered checkpoints and a finish line, drop blockers, then drive the track.
Vite + TypeScript + Phaser 3, no backend.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
```

## Play

**Build mode** (toolbar tools):

| Tool | Action |
| --- | --- |
| Road | Click or drag on the canvas to lay road points (90 px wide road, round joints). *Undo point* removes the last one. |
| Checkpoint | Click on the road to add a gate. Gates must be crossed in numbered order. |
| Finish line | Click on the road to set the checkered finish gate (the car starts at the green START dot, facing along the road). |
| Blocker | Click anywhere to drop a round blocker. |
| Erase | Click a blocker / checkpoint / finish line to remove it. Right-click erases with any tool. |

**Race mode** (*Start Race* — requires at least 2 road points and a finish line):
WASD or arrow keys drive (accelerate, brake/reverse, steer). Road edges and blockers stop the car.
Pass every checkpoint in order, then cross the finish line to win. `R` or *Restart* resets the car;
*Back to Build* unlocks editing.

## Code

```
index.html          toolbar (plain DOM) + game container
src/main.ts         Phaser game config + toolbar wiring
src/GameScene.ts    the single scene: build tools, car physics, collisions, gates, rendering
src/track.ts        track data model + the few geometry helpers (no Phaser dependency)
e2e/                optional Playwright play-tests (not a project dependency)
```

Design notes:
- The road is a centerline polyline rendered `width` px thick with round joints, so "on the road" is simply
  *distance to the polyline <= width / 2*. The car is treated as a circle; when it leaves the road or overlaps
  a blocker it is pushed back and loses half its speed.
- Checkpoints and the finish line are segments across the road; crossing is detected by intersecting the car's
  per-frame movement segment with the gate (`Phaser.Geom.Intersects.LineToLine`), so no tunnelling at speed.

## Optional play-tests

The scripts in `e2e/` drive the real game in headless Chromium (mouse clicks + key presses) and assert the
acceptance criteria. They need Playwright, which is intentionally not part of this project:

```bash
npm run dev &                                     # dev server on :5173
mkdir -p /tmp/e2e && cd /tmp/e2e && npm i playwright@1.47.0 && npx playwright install --with-deps chromium
PLAYWRIGHT_DIR=/tmp/e2e \
  node /path/to/racing-track-builder/e2e/features.cjs
PLAYWRIGHT_DIR=/tmp/e2e node /path/to/racing-track-builder/e2e/invariants.cjs
```
