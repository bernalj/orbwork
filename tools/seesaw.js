// Exact solver + level search for the Seesaw.
//
//   node tools/seesaw.js report                          for every Seesaw level: how many seatings balance
//   node tools/seesaw.js search [count] [seconds] [--blobs=3-5] [--seated=1-2] [--maxw=6]   random search, hardest first
//
// Rules modelled: 7 seats at distances -3..3. A blob weighs as many units as it has eyes. Some blobs start seated.
// Everyone has to be aboard, and the plank is level when the sum of weight x distance is 0. Each drop is a move,
// so par is the number of blobs; the challenge is finding a balancing seating without trial and error.
// "odds" = balancing seatings / all seatings (seatings that only swap identical blobs count once).
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const POS = [-3, -2, -1, 0, 1, 2, 3];

// every distinct way to seat these weights in the free seats -> [{seats:{pos:w}, torque}]
function seatings(weights, locked) {
  const free = POS.filter(p => locked[p] === undefined), out = [], seen = new Set();
  const base = Object.entries(locked).reduce((t, [p, w]) => t + (+p) * w, 0);
  const rec = (i, used, cur, tq) => {
    if (i === weights.length) { const k = Object.keys(cur).sort().map(p => p + ':' + cur[p]).join(','); if (!seen.has(k)) { seen.add(k); out.push({ seats: { ...cur }, torque: tq }); } return; }
    for (const p of free) if (!used.has(p)) { used.add(p); cur[p] = weights[i]; rec(i + 1, used, cur, tq + p * weights[i]); delete cur[p]; used.delete(p); }
  };
  rec(0, new Set(), {}, base); return out;
}
function analyse(level) {
  const all = seatings(level.orbs, level.locked), wins = all.filter(s => s.torque === 0);
  // "close calls": seatings off by exactly one unit of torque (they look almost right)
  const near = all.filter(s => Math.abs(s.torque) === 1).length;
  const show = s => POS.map(p => level.locked[p] !== undefined ? `[${level.locked[p]}]` : s.seats[p] !== undefined ? ` ${s.seats[p]} ` : ' . ').join('');
  return { total: all.length, wins: wins.length, odds: wins.length / all.length, near, sample: wins.length ? show(wins[0]) : null, allWins: wins.map(show) };
}
function currentLevels() {
  const i = SRC.indexOf('const WS = {'), j = SRC.indexOf('levels:[', i), k = SRC.indexOf('\n  ],', j);
  return [...SRC.slice(j + 8, k).matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*machines:\[\],\s*gate:ssGate\((\{[^}]*\})\),\s*par:(\d+)/g)]
    .map(m => ({ name: m[1], orbs: eval(m[2]).map(t => +t[1]), locked: Object.fromEntries(Object.entries(eval('(' + m[3] + ')')).map(([p, w]) => [+p, w])), par: +m[4] }));
}
module.exports = { seatings, analyse, currentLevels };

if (require.main === module) {
  const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
  const [cmd, countArg = '12', secsArg = '30'] = argv.filter(a => !a.startsWith('--'));
  const pad = (s, n) => String(s).padEnd(n);
  const lockStr = l => Object.entries(l).map(([p, w]) => `${w}@${p}`).join(' ') || '-';
  if (cmd === 'report') currentLevels().forEach((l, i) => { const a = analyse(l);
    console.log(`${String(i + 1).padStart(2)} ${pad(l.name, 15)} blobs ${pad(l.orbs.join(','), 9)} seated ${pad(lockStr(l.locked), 10)} balancing ${a.wins}/${a.total} (${(a.odds * 100).toFixed(1)}%)  near-misses ${a.near}  e.g. ${a.sample}`); });
  if (cmd === 'search') {
    const [bmin, bmax] = (flags.blobs || '3-5').split('-').map(Number), [smin, smax] = (flags.seated || '1-2').split('-').map(Number), MAXW = +(flags.maxw || 6);
    const pick = a => a[Math.floor(Math.random() * a.length)], found = new Map(), deadline = Date.now() + 1000 * +secsArg;
    while (Date.now() < deadline) {
      const n = bmin + Math.floor(Math.random() * (bmax - bmin + 1)), m = smin + Math.floor(Math.random() * (smax - smin + 1));
      if (n + m > 7) continue;
      const locked = {}; while (Object.keys(locked).length < m) locked[pick(POS.filter(p => p))] = 1 + Math.floor(Math.random() * MAXW);
      const orbs = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * MAXW)).sort();
      const k = orbs.join(',') + '|' + lockStr(locked); if (found.has(k)) continue;
      const a = analyse({ orbs, locked }); found.set(k, a.wins ? { orbs, locked, ...a } : null);
    }
    const best = [...found.values()].filter(Boolean).sort((a, b) => a.wins - b.wins || a.odds - b.odds || b.near - a.near).slice(0, +countArg);
    best.forEach(c => console.log(pad(c.orbs.join(','), 11), 'seated', pad(lockStr(c.locked), 12), `balancing ${c.wins}/${c.total} (${(c.odds * 100).toFixed(2)}%)  near-misses ${c.near}  |  ${c.allWins.join('   ')}`));
    console.log('examined', found.size);
  }
}
