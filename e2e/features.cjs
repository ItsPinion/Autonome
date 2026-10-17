// End-to-end play-test of the racing MVP: builds a track with real mouse clicks, drives with real key presses.
const { chromium } = require(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + '/node_modules/playwright' : 'playwright');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const problems = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message') && problems.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e}`));

  await page.goto('http://localhost:5173/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  const box = await page.locator('canvas').boundingBox();
  const toPage = (x, y) => [box.x + (x * box.width) / 960, box.y + (y * box.height) / 600];
  const click = async (x, y, button = 'left') => { const [px, py] = toPage(x, y); await page.mouse.click(px, py, { button }); await page.waitForTimeout(40); };
  const tool = (name) => page.click(`[data-tool="${name}"]`);
  const state = () => page.evaluate(() => import(document.querySelector("script[type=module][src*=main]").src).then(({ scene: s }) => ({
    mode: s.mode, tool: s.tool, points: s.track.points.length, cps: s.track.checkpoints.length,
    finish: !!s.track.finish, blockers: s.track.blockers.length,
    car: { x: s.car.x, y: s.car.y }, next: s.nextCheckpoint, finished: s.finished, speed: s.speed,
    msg: s.message.visible ? s.message.text : '',
  })));
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
  const step = (name) => console.log('✔', name);

  // 1. Starting a race with no track must be refused.
  await page.click('#mode');
  let s = await state();
  assert.strictEqual(s.mode, 'build'); assert.match(s.msg, /Draw a road/);
  step('race refused without a road');

  // 2. Draw a straight road with clicks, then extend it by dragging.
  for (const x of [100, 300, 500, 700, 850]) await click(x, 300);
  s = await state(); assert.strictEqual(s.points, 5);
  const [dx, dy] = toPage(850, 300);
  await page.mouse.move(dx, dy); await page.mouse.down();
  for (let y = 300; y <= 460; y += 20) { await page.mouse.move(dx, dy + (y - 300) * (box.height / 600)); await page.waitForTimeout(20); }
  await page.mouse.up();
  s = await state(); assert.ok(s.points >= 8, `drag should add points, got ${s.points}`);
  const afterDrag = s.points;
  await page.click('#undo'); s = await state(); assert.strictEqual(s.points, afterDrag - 1);
  step(`road drawn (${s.points} points), drag + undo work`);

  // 3. Race refused without a finish line.
  await page.click('#mode'); s = await state();
  assert.strictEqual(s.mode, 'build'); assert.match(s.msg, /finish line/);
  step('race refused without a finish line');

  // 4. Checkpoints (one off-road click must be ignored) and finish line.
  await tool('checkpoint'); await click(300, 300); await click(600, 300); await click(300, 100);
  await tool('finish'); await click(800, 300);
  s = await state(); assert.strictEqual(s.cps, 2); assert.strictEqual(s.finish, true);
  step('2 checkpoints + finish placed, off-road click ignored');

  // 5. Blockers: place three, erase one with the tool, one with right-click. Keep one in the car's path.
  await tool('blocker'); await click(450, 300); await click(450, 100); await click(200, 500);
  s = await state(); assert.strictEqual(s.blockers, 3);
  await tool('erase'); await click(450, 100);
  await click(200, 500, 'right');
  s = await state(); assert.strictEqual(s.blockers, 1);
  step('blockers placed, erased by tool and by right-click');
  await page.screenshot({ path: '/tmp/e2e/build.png' });

  // 6. Race: the blocker at x=450 must stop the car (car radius 10 + blocker 14 => x stays < 450).
  await page.click('#mode'); s = await state();
  assert.strictEqual(s.mode, 'race'); assert.deepStrictEqual(s.car, { x: 100, y: 300 });
  assert.strictEqual(await page.isHidden('#build-tools'), true);
  await hold(['ArrowUp'], 2500);
  s = await state();
  assert.ok(s.car.x > 380 && s.car.x < 450, `car should be stopped by the blocker, x=${s.car.x}`);
  assert.strictEqual(s.next, 1, 'checkpoint 1 should be passed before the blocker');
  assert.strictEqual(s.finished, false);
  step(`blocker stops the car (x=${s.car.x.toFixed(1)}), checkpoint 1 counted`);
  await page.screenshot({ path: '/tmp/e2e/blocked.png' });

  // 7. Walls: steer hard into the top edge; car centre must stay within road half-width minus car radius (35px).
  await page.keyboard.press('KeyR'); s = await state(); assert.deepStrictEqual([s.car.x, s.next], [100, 0]);
  await hold(['KeyW', 'KeyA'], 1500);
  s = await state();
  assert.ok(s.car.y >= 300 - 35 - 0.01, `car escaped the road, y=${s.car.y}`);
  assert.ok(s.car.y < 300 - 20, `car should have been pushed up against the wall, y=${s.car.y}`);
  step(`track boundary holds the car (y=${s.car.y.toFixed(1)})`);

  // 8. Remove the blocker in build mode, race again and finish. Also checks the Restart button.
  await page.click('#mode'); s = await state(); assert.strictEqual(s.mode, 'build');
  await tool('erase'); await click(450, 300); s = await state(); assert.strictEqual(s.blockers, 0);
  await page.click('#mode'); await hold(['ArrowUp'], 800); await page.click('#restart');
  s = await state(); assert.deepStrictEqual([s.car.x, s.car.y, s.next, s.finished], [100, 300, 0, false]);
  await hold(['ArrowUp'], 3500);
  s = await state();
  assert.strictEqual(s.next, 2); assert.strictEqual(s.finished, true); assert.match(s.msg, /FINISHED/);
  step(`finished the race: ${s.msg.split('\n')[0]}`);
  await page.screenshot({ path: '/tmp/e2e/finished.png' });

  // 9. Order enforcement: checkpoints placed in reverse order, so driving forward hits #2 first (ignored).
  await page.click('#mode'); await tool('erase'); await click(300, 300); await click(600, 300);
  await tool('checkpoint'); await click(600, 300); await click(300, 300);
  await page.click('#mode'); await hold(['ArrowUp'], 3500);
  s = await state();
  assert.strictEqual(s.next, 1, 'only checkpoint #1 (at x=300) should count');
  assert.strictEqual(s.finished, false, 'finish must not count with checkpoints missing');
  step('checkpoint order is enforced; finish ignored until all checkpoints are done');

  // 10. Clear all.
  await page.click('#mode'); await page.click('#clear'); s = await state();
  assert.deepStrictEqual([s.points, s.cps, s.finish, s.blockers], [0, 0, false, 0]);
  step('clear all works');

  await browser.close();
  if (problems.length) { console.log('\nBrowser console problems:'); problems.forEach((p) => console.log('  ' + p)); process.exit(1); }
  console.log('\nALL CHECKS PASSED');
})().catch((e) => { console.error('\n✘ FAILED:', e.message); process.exit(1); });
