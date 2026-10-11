// Dev smoke test: runs the real app with a throwaway profile, replays scripted input, saves screenshots.
//   npx electron test/smoke.js plan.json
// plan.json: { "seed": "save.json"?, "size": [1280, 800]?, "steps": [...] }
// Steps run in order: {"wait":ms} {"shot":"file.png"} {"drag":[x1,y1,x2,y2]} {"click":[x,y]} {"key":"KeyName"} {"js":"expression"}
//   {"dragColor":[r,g,b], "region":[x0,y0,x1,y1], "to":[x,y]}  drags the first blob of that color found in region (orb spawns are random)
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const planFile = process.argv[process.argv.findIndex(a => path.resolve(a) === __filename) + 1];
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const [w, h] = plan.size || [1280, 800];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'orbwork-smoke-')));
if (plan.seed) {
  fs.mkdirSync(path.join(app.getPath('userData'), 'saves'), { recursive: true });
  fs.copyFileSync(plan.seed, path.join(app.getPath('userData'), 'saves', 'save.json'));
}
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ fullscreen: false, bounds: { x: 40, y: 40, width: w, height: h } }));

require('../electron/main.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Centroid of the first blob within `tol` of rgb inside region, from a live capture (page coordinates).
async function findColor(wc, rgb, [x0, y0, x1, y1], tol = 40) {
  const img = await wc.capturePage();
  const { width, height } = img.getSize();
  const sx = width / img.getSize().width, bmp = img.toBitmap(); // BGRA
  const hit = (x, y) => { const i = (y * width + x) * 4; return Math.abs(bmp[i + 2] - rgb[0]) + Math.abs(bmp[i + 1] - rgb[1]) + Math.abs(bmp[i] - rgb[2]) < tol; };
  for (let y = y0; y < Math.min(y1, height); y += 2) for (let x = x0; x < Math.min(x1, width); x += 2) {
    if (!hit(x, y)) continue;
    let n = 0, ax = 0, ay = 0;
    for (let yy = Math.max(0, y - 10); yy < Math.min(height, y + 60); yy++) for (let xx = Math.max(0, x - 35); xx < Math.min(width, x + 35); xx++) if (hit(xx, yy)) { n++; ax += xx; ay += yy; }
    return [ax / n / sx, ay / n / sx];
  }
  return null;
}

async function run(win) {
  const wc = win.webContents;
  const move = (x, y, type, extra = {}) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  for (const step of plan.steps) {
    if ('wait' in step) await sleep(step.wait);
    else if ('shot' in step) { const img = await wc.capturePage(); fs.writeFileSync(step.shot, img.toPNG()); console.log('[smoke] shot', step.shot); }
    else if ('drag' in step) {
      const [x1, y1, x2, y2] = step.drag;
      move(x1, y1, 'mouseMove'); move(x1, y1, 'mouseDown'); await sleep(60);
      for (let t = 1; t <= 12; t++) { move(x1 + (x2 - x1) * t / 12, y1 + (y2 - y1) * t / 12, 'mouseMove', { modifiers: ['leftButtonDown'] }); await sleep(16); }
      move(x2, y2, 'mouseUp'); await sleep(60);
    }
    else if ('dragColor' in step) {
      const at = await findColor(wc, step.dragColor, step.region);
      console.log('[smoke] dragColor found', JSON.stringify(at && at.map(Math.round)));
      if (at) { const [x1, y1] = at, [x2, y2] = step.to;
        move(x1, y1, 'mouseMove'); move(x1, y1, 'mouseDown'); await sleep(60);
        for (let t = 1; t <= 12; t++) { move(x1 + (x2 - x1) * t / 12, y1 + (y2 - y1) * t / 12, 'mouseMove', { modifiers: ['leftButtonDown'] }); await sleep(16); }
        move(x2, y2, 'mouseUp'); await sleep(60); }
    }
    else if ('click' in step) { const [x, y] = step.click; move(x, y, 'mouseMove'); move(x, y, 'mouseDown'); await sleep(40); move(x, y, 'mouseUp'); }
    else if ('key' in step) { wc.sendInputEvent({ type: 'keyDown', keyCode: step.key }); wc.sendInputEvent({ type: 'keyUp', keyCode: step.key }); await sleep(30); }
    else if ('js' in step) console.log('[smoke] js', JSON.stringify(await wc.executeJavaScript(step.js)));
    else console.warn('[smoke] unknown step', JSON.stringify(step));
  }
  console.log('[smoke] save:', (() => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'saves', 'save.json'), 'utf8').slice(0, 200); } catch { return 'none'; } })());
  app.quit();
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', e => { if (e.level === 'warning' || e.level === 'error') console.log(`[smoke] console ${e.level}: ${e.message.slice(0, 200)}`); });
  win.webContents.once('did-finish-load', () => sleep(1500).then(() => run(win)).catch(e => { console.error(e); app.exit(1); }));
});
