// Drives a U-shaped track with blockers using a crude waypoint autopilot (real key events),
// sampling the car every 50ms to make sure it never leaves the road or sinks into a blocker,
// and that it can actually complete a bendy track.
const { chromium } = require(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + '/node_modules/playwright' : 'playwright');
const assert = require('assert');

const POINTS = [
  { x: 120, y: 120 }, { x: 400, y: 120 }, { x: 700, y: 140 }, { x: 840, y: 300 },
  { x: 700, y: 470 }, { x: 400, y: 480 }, { x: 150, y: 450 },
];
const BLOCKERS = [{ x: 400, y: 100, r: 14 }, { x: 780, y: 330, r: 14 }, { x: 420, y: 500, r: 14 }];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  page.on('pageerror', (e) => { console.error('[pageerror]', e); process.exit(1); });
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);

  const mod = () => `import(document.querySelector("script[type=module][src*=main]").src)`;
  // Build the track through the public data model + the same gate helper the tools use.
  await page.evaluate(`(${mod()}).then(async ({ scene }) => {
    const { gateAt } = await import('/src/track.ts');
    scene.track.points = ${JSON.stringify(POINTS)};
    scene.track.blockers = ${JSON.stringify(BLOCKERS)};
    scene.track.checkpoints = [gateAt(scene.track, { x: 550, y: 130 }), gateAt(scene.track, { x: 840, y: 300 }), gateAt(scene.track, { x: 550, y: 475 })];
    scene.track.finish = gateAt(scene.track, { x: 220, y: 460 });
  })`);
  await page.click('#mode');
  const state = () => page.evaluate(`(${mod()}).then(async ({ scene: s }) => {
    const { nearestOnPolyline } = await import('/src/track.ts');
    const p = { x: s.car.x, y: s.car.y };
    return { mode: s.mode, x: p.x, y: p.y, heading: s.heading, next: s.nextCheckpoint, finished: s.finished, time: s.raceTime,
      roadDist: nearestOnPolyline(s.track.points, p).dist,
      blockerDist: Math.min(...s.track.blockers.map(b => Math.hypot(b.x - p.x, b.y - p.y))) };
  })`);

  let s = await state();
  assert.strictEqual(s.mode, 'race');
  await page.keyboard.down('ArrowUp');
  let wp = 1, steering = null, maxRoad = 0, minBlocker = Infinity, samples = 0;
  const deadline = Date.now() + 40000;
  while (!s.finished && Date.now() < deadline) {
    await page.waitForTimeout(50);
    s = await state();
    samples++;
    maxRoad = Math.max(maxRoad, s.roadDist);
    minBlocker = Math.min(minBlocker, s.blockerDist);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'car position must stay finite');
    assert.ok(s.roadDist <= 35 + 0.5, `car left the road: dist ${s.roadDist.toFixed(2)} at (${s.x.toFixed(0)}, ${s.y.toFixed(0)})`);
    assert.ok(s.blockerDist >= 24 - 3, `car sank into a blocker: dist ${s.blockerDist.toFixed(2)}`);
    // Autopilot: aim at the next waypoint, advance when close.
    let target = POINTS[Math.min(wp, POINTS.length - 1)];
    if (Math.hypot(target.x - s.x, target.y - s.y) < 45 && wp < POINTS.length - 1) target = POINTS[++wp];
    let diff = Math.atan2(target.y - s.y, target.x - s.x) - s.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const want = diff > 0.08 ? 'ArrowRight' : diff < -0.08 ? 'ArrowLeft' : null;
    if (want !== steering) {
      if (steering) await page.keyboard.up(steering);
      if (want) await page.keyboard.down(want);
      steering = want;
    }
  }
  await page.keyboard.up('ArrowUp');
  if (steering) await page.keyboard.up(steering);
  await page.screenshot({ path: '/tmp/e2e/ushape.png' });
  assert.strictEqual(s.finished, true, `autopilot did not finish (next=${s.next}, at ${s.x.toFixed(0)},${s.y.toFixed(0)})`);
  assert.strictEqual(s.next, 3);
  console.log(`✔ U-track finished in ${s.time.toFixed(2)}s; ${samples} samples; max road dist ${maxRoad.toFixed(1)}/35; min blocker dist ${minBlocker.toFixed(1)}/24`);
  await browser.close();
  console.log('INVARIANTS HOLD');
})().catch((e) => { console.error('✘ FAILED:', e.message); process.exit(1); });
