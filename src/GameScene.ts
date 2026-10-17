import Phaser from 'phaser';
import { Track, Vec, Gate, emptyTrack, mid, nearestOnPolyline, gateAt, distToGate } from './track';

export type Tool = 'road' | 'checkpoint' | 'finish' | 'blocker' | 'erase';
export type Mode = 'build' | 'race';

export const GAME_W = 960;
export const GAME_H = 600;

const ROAD_WIDTH = 90;
const BLOCKER_R = 14;
const CAR_R = 10; // the car collides as a circle of this radius

// Arcade car tuning (px, seconds, radians).
const ACCEL = 320;
const BRAKE = 450;
const REVERSE_ACCEL = 180;
const MAX_SPEED = 340;
const MAX_REVERSE = 130;
const COAST_FRICTION = 1.5; // fraction of speed lost per second while coasting
const TURN_RATE = 3.0; // rad/s at full steering authority
const HIT_SPEED_KEEP = 0.5; // speed multiplier when touching a wall or blocker

type Keys = Record<'up' | 'down' | 'left' | 'right' | 'W' | 'A' | 'S' | 'D' | 'R', Phaser.Input.Keyboard.Key>;

export default class GameScene extends Phaser.Scene {
  mode: Mode = 'build';
  tool: Tool = 'road';
  track: Track = emptyTrack(ROAD_WIDTH);

  // Race state
  private heading = 0;
  private speed = 0;
  private nextCheckpoint = 0;
  private finished = false;
  private raceTime = 0;

  // Display objects
  private car!: Phaser.GameObjects.Image;
  private trackGfx!: Phaser.GameObjects.Graphics;
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private messageTimer?: Phaser.Time.TimerEvent;
  private keys!: Keys;

  constructor() {
    super('game');
  }

  create() {
    // Car texture: red body with a yellow nose so the facing direction is obvious.
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xe63946).fillRect(0, 0, 28, 16).fillStyle(0xffd166).fillRect(20, 3, 6, 10);
    g.generateTexture('car', 28, 16);
    g.destroy();

    this.trackGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();
    this.car = this.add.image(0, 0, 'car').setDepth(5).setVisible(false);

    const text = { fontFamily: 'monospace', color: '#ffffff', backgroundColor: '#000000aa' };
    this.status = this.add.text(8, 8, '', { ...text, fontSize: '15px', padding: { x: 6, y: 4 } }).setDepth(10);
    this.message = this.add
      .text(GAME_W / 2, GAME_H / 2, '', { ...text, fontSize: '30px', align: 'center', padding: { x: 16, y: 10 } })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    const kb = this.input.keyboard!;
    const c = kb.createCursorKeys();
    const k = kb.addKeys('W,A,S,D,R') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys = { up: c.up, down: c.down, left: c.left, right: c.right, W: k.W, A: k.A, S: k.S, D: k.D, R: k.R };

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p, true));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => p.isDown && this.onPointer(p, false));

    this.refresh();
  }

  update(_time: number, delta: number) {
    if (this.mode === 'build') {
      this.drawCursor();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.restartRace();
    if (this.finished) return;
    const dt = Math.min(delta, 50) / 1000; // clamp so a stalled tab can't launch the car through walls
    this.driveCar(dt);
    this.raceTime += dt;
    this.updateStatus();
  }

  // ---------------------------------------------------------------- public API (used by the toolbar)

  /** Locks the track and starts racing. Returns false (with an on-screen reason) if the track isn't raceable. */
  startRace(): boolean {
    if (this.track.points.length < 2) return this.showMessage('Draw a road first (at least 2 points)', 2000), false;
    if (!this.track.finish) return this.showMessage('Place a finish line first', 2000), false;
    this.mode = 'race';
    this.cursorGfx.clear();
    this.car.setVisible(true);
    this.restartRace();
    return true;
  }

  enterBuild() {
    this.mode = 'build';
    this.car.setVisible(false);
    this.nextCheckpoint = 0;
    this.finished = false;
    this.hideMessage();
    this.refresh();
  }

  restartRace() {
    const [p0, p1] = this.track.points;
    this.heading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    this.speed = 0;
    this.car.setPosition(p0.x, p0.y).setRotation(this.heading);
    this.nextCheckpoint = 0;
    this.finished = false;
    this.raceTime = 0;
    this.hideMessage();
    this.refresh();
  }

  undoPoint() {
    this.track.points.pop();
    // Drop gates that no longer sit on the road.
    const onRoad = (g: Gate) => gateAt(this.track, mid(g)) !== null;
    this.track.checkpoints = this.track.checkpoints.filter(onRoad);
    if (this.track.finish && !onRoad(this.track.finish)) this.track.finish = null;
    this.refresh();
  }

  clearTrack() {
    this.track = emptyTrack(ROAD_WIDTH);
    this.refresh();
  }

  // ---------------------------------------------------------------- build mode

  private onPointer(p: Phaser.Input.Pointer, isDown: boolean) {
    if (this.mode !== 'build') return;
    const pos = { x: p.x, y: p.y };
    const t = this.track;
    let changed = true;

    if (p.rightButtonDown()) {
      changed = isDown && this.eraseAt(pos);
    } else if (this.tool === 'road') {
      // A click always adds a point; while dragging, add one every 40px so a stroke becomes a chain of points.
      const last = t.points[t.points.length - 1];
      const minGap = isDown ? 10 : 40;
      changed = !last || Math.hypot(pos.x - last.x, pos.y - last.y) >= minGap;
      if (changed) t.points.push(pos);
    } else if (!isDown) {
      return; // other tools act on click only
    } else if (this.tool === 'checkpoint' || this.tool === 'finish') {
      const gate = gateAt(t, pos);
      if (!gate) return this.showMessage('Click on the road', 1200);
      if (this.tool === 'checkpoint') t.checkpoints.push(gate);
      else t.finish = gate;
    } else if (this.tool === 'blocker') {
      t.blockers.push({ x: pos.x, y: pos.y, r: BLOCKER_R });
    } else {
      changed = this.eraseAt(pos);
    }
    if (changed) this.refresh();
  }

  /** Removes the blocker, checkpoint or finish line under `p`. Returns whether something was removed. */
  private eraseAt(p: Vec): boolean {
    const t = this.track;
    const bi = t.blockers.findIndex((b) => Math.hypot(b.x - p.x, b.y - p.y) <= b.r + 6);
    if (bi >= 0) return t.blockers.splice(bi, 1), true;
    const ci = t.checkpoints.findIndex((g) => distToGate(g, p) <= 10);
    if (ci >= 0) return t.checkpoints.splice(ci, 1), true;
    if (t.finish && distToGate(t.finish, p) <= 10) return (t.finish = null), true;
    return false;
  }

  /** Ghost preview of what a click would place with the current tool. */
  private drawCursor() {
    const g = this.cursorGfx.clear();
    const { x, y } = this.input.activePointer;
    const t = this.track;
    if (this.tool === 'road') {
      const last = t.points[t.points.length - 1];
      g.lineStyle(t.width, 0xffffff, 0.25).fillStyle(0xffffff, 0.25);
      if (last) g.lineBetween(last.x, last.y, x, y);
      g.fillCircle(x, y, t.width / 2);
    } else if (this.tool === 'checkpoint' || this.tool === 'finish') {
      const gate = gateAt(t, { x, y });
      if (gate) g.lineStyle(6, this.tool === 'finish' ? 0xffffff : 0xffd166, 0.7).lineBetween(gate.a.x, gate.a.y, gate.b.x, gate.b.y);
    } else if (this.tool === 'blocker') {
      g.fillStyle(0xc0392b, 0.5).fillCircle(x, y, BLOCKER_R);
    } else {
      g.lineStyle(2, 0xffffff, 0.8).strokeCircle(x, y, 10);
    }
  }

  // ---------------------------------------------------------------- race mode

  private driveCar(dt: number) {
    const k = this.keys;
    const throttle = k.up.isDown || k.W.isDown;
    const brake = k.down.isDown || k.S.isDown;
    const steer = (k.left.isDown || k.A.isDown ? -1 : 0) + (k.right.isDown || k.D.isDown ? 1 : 0);

    if (throttle) this.speed += ACCEL * dt;
    else if (brake) this.speed -= (this.speed > 0 ? BRAKE : REVERSE_ACCEL) * dt;
    else this.speed -= this.speed * Math.min(1, COAST_FRICTION * dt);
    this.speed = Phaser.Math.Clamp(this.speed, -MAX_REVERSE, MAX_SPEED);
    if (!throttle && !brake && Math.abs(this.speed) < 3) this.speed = 0;

    // Steering authority grows with speed (no spinning on the spot) and flips when reversing, like a real car.
    const grip = Math.min(1, Math.abs(this.speed) / 120) * Math.sign(this.speed);
    this.heading += steer * TURN_RATE * grip * dt;

    const prev = { x: this.car.x, y: this.car.y };
    const pos = { x: prev.x + Math.cos(this.heading) * this.speed * dt, y: prev.y + Math.sin(this.heading) * this.speed * dt };
    this.collide(pos);
    this.car.setPosition(pos.x, pos.y).setRotation(this.heading);
    this.checkGates(prev, pos);
  }

  /**
   * Keeps the car outside blockers and inside the road by pushing it back out, scrubbing speed on contact.
   * The road check runs last so the car can never end a frame off the track.
   */
  private collide(pos: Vec) {
    for (const b of this.track.blockers) {
      const d = Math.hypot(pos.x - b.x, pos.y - b.y);
      const minD = b.r + CAR_R;
      if (d < minD && d > 0) {
        pos.x = b.x + ((pos.x - b.x) / d) * minD;
        pos.y = b.y + ((pos.y - b.y) / d) * minD;
        this.speed *= HIT_SPEED_KEEP;
      }
    }
    const limit = this.track.width / 2 - CAR_R;
    const n = nearestOnPolyline(this.track.points, pos)!;
    if (n.dist > limit) {
      pos.x = n.point.x + ((pos.x - n.point.x) / n.dist) * limit;
      pos.y = n.point.y + ((pos.y - n.point.y) / n.dist) * limit;
      this.speed *= HIT_SPEED_KEEP;
    }
  }

  /** Checkpoints count only in order; the finish line counts only once every checkpoint is done. */
  private checkGates(prev: Vec, pos: Vec) {
    if (prev.x === pos.x && prev.y === pos.y) return;
    const moved = new Phaser.Geom.Line(prev.x, prev.y, pos.x, pos.y);
    const crossed = (g: Gate) => Phaser.Geom.Intersects.LineToLine(moved, new Phaser.Geom.Line(g.a.x, g.a.y, g.b.x, g.b.y));
    const cps = this.track.checkpoints;
    if (this.nextCheckpoint < cps.length) {
      if (crossed(cps[this.nextCheckpoint])) {
        this.nextCheckpoint++;
        this.drawTrack();
      }
    } else if (this.track.finish && crossed(this.track.finish)) {
      this.finished = true;
      this.speed = 0;
      this.showMessage(`FINISHED in ${this.raceTime.toFixed(2)}s!\nPress R or Restart to race again`);
    }
  }

  // ---------------------------------------------------------------- rendering

  private refresh() {
    this.drawTrack();
    this.updateStatus();
  }

  private drawTrack() {
    const g = this.trackGfx.clear();
    this.labels.forEach((l) => l.destroy());
    this.labels = [];
    const { points, width, checkpoints, finish, blockers } = this.track;

    // Road: thick polyline with round joints. A darker, wider copy underneath is the visible boundary.
    for (const [color, w] of [[0x263238, width + 8], [0x6d6d6d, width]] as const) {
      g.lineStyle(w, color).fillStyle(color);
      for (let i = 0; i < points.length - 1; i++) g.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
      for (const p of points) g.fillCircle(p.x, p.y, w / 2);
    }
    if (this.mode === 'build') {
      g.fillStyle(0xffffff, 0.5);
      for (const p of points) g.fillCircle(p.x, p.y, 4);
    }
    if (points.length) {
      g.fillStyle(0x2ecc71).fillCircle(points[0].x, points[0].y, 8);
      this.label(points[0], 'START', -18);
    }

    checkpoints.forEach((c, i) => {
      const done = i < this.nextCheckpoint;
      const next = i === this.nextCheckpoint && this.mode === 'race';
      g.lineStyle(4, done ? 0x2ecc71 : next ? 0xffd166 : 0xffffff).lineBetween(c.a.x, c.a.y, c.b.x, c.b.y);
      this.label(mid(c), String(i + 1));
    });

    if (finish) {
      // Checkered look: alternate black and white dashes along the gate.
      const N = 8;
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        g.lineStyle(10, i % 2 ? 0x000000 : 0xffffff).lineBetween(
          Phaser.Math.Linear(finish.a.x, finish.b.x, t0), Phaser.Math.Linear(finish.a.y, finish.b.y, t0),
          Phaser.Math.Linear(finish.a.x, finish.b.x, t1), Phaser.Math.Linear(finish.a.y, finish.b.y, t1),
        );
      }
    }

    for (const b of blockers) g.fillStyle(0xc0392b).fillCircle(b.x, b.y, b.r).lineStyle(3, 0x7b241c).strokeCircle(b.x, b.y, b.r);
  }

  private label(p: Vec, text: string, dy = 0) {
    const style = { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#000000cc', padding: { x: 3, y: 1 } };
    this.labels.push(this.add.text(p.x, p.y + dy, text, style).setOrigin(0.5).setDepth(6));
  }

  private updateStatus() {
    const t = this.track;
    this.status.setText(
      this.mode === 'build'
        ? `BUILD   road points: ${t.points.length}   checkpoints: ${t.checkpoints.length}   finish: ${t.finish ? 'set' : 'missing'}   blockers: ${t.blockers.length}`
        : `RACE   checkpoints: ${this.nextCheckpoint}/${t.checkpoints.length}   time: ${this.raceTime.toFixed(1)}s`,
    );
  }

  private showMessage(text: string, ms?: number) {
    this.message.setText(text).setVisible(true);
    this.messageTimer?.remove();
    this.messageTimer = ms ? this.time.delayedCall(ms, () => this.message.setVisible(false)) : undefined;
  }

  private hideMessage() {
    this.messageTimer?.remove();
    this.message.setVisible(false);
  }
}
