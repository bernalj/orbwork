// Exact solver + level search for the Queue, using the game's own qJoin (how a newcomer reacts as it joins).
//
//   node tools/queue.js report                                  par / solutions / traps / random-win for every Queue level
//   node tools/queue.js search <par> [count] [seconds] [--blobs=3-4] [--cups=coffee,pillow]   random search
//
// Rules modelled: a move is either dropping a floor blob into the Ticket line (it joins at the back, then reacts:
// Sleepy stays, Clingy goes behind the last blob of its color, Pushy swaps one place forward, Eager goes to the
// front) or putting a floor blob in the Coffee (one step livelier) / Pillow (one step calmer). The level is won
// when the line is full and its colors match the booths. A level may start with blobs already in line (line:[...]). A full line in the wrong order sends everyone back out.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const grab = re => { const m = SRC.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
const { qJoin, Q_UP, Q_DOWN } = new Function([grab(/const Q_UP=[^\n]+\n/), grab(/function qJoin\(line, o\)\{[\s\S]*?\n\}\n/)].join('') + 'return { qJoin, Q_UP, Q_DOWN };')();

const sortK = a => a.slice().sort().join(' ');
const key = s => s.line.join(',') + '|' + sortK(s.floor);
const won = (s, gate) => s.line.length === gate.length && s.line.every((t, i) => gate[i] === 'any' || gate[i] === t[0]);
function join(line, t) { const r = qJoin(line.map(x => ({ c: x[0], q: x[1] })), { c: t[0], q: t[1] }); return r.line.map(o => o.c + o.q); }
function moves(s, cups, gate) {
  const out = [], seen = new Set();
  for (let i = 0; i < s.floor.length; i++) { const t = s.floor[i]; if (seen.has(t)) continue; seen.add(t);
    const rest = s.floor.filter((_, k) => k !== i);
    let line = join(s.line, t), floor = rest;
    if (line.length === gate.length && !won({ line }, gate)) { floor = rest.concat(line); line = []; }   // wrong order: everyone steps out
    out.push({ act: 'join ' + t, next: { line, floor } });
    for (const c of cups) { const q = (c === 'coffee' ? Q_UP : Q_DOWN)[t[1]]; if (q === t[1]) continue;
      out.push({ act: c + ' ' + t, next: { line: s.line, floor: rest.concat(t[0] + q) } }); }
  }
  return out;
}
function solve(level, maxDepth = 10) {
  const start = { line: (level.line || []).slice(), floor: level.orbs.slice() }, ways = new Map([[key(start), 1]]), parent = new Map(); let fr = [start];
  for (let d = 1; d <= maxDepth && fr.length; d++) {
    const nx = new Map();
    for (const s of fr) for (const mv of moves(s, level.cups, level.gate)) { const k = key(mv.next), w = ways.get(key(s));
      if (!ways.has(k)) { ways.set(k, w); parent.set(k, [key(s), mv]); nx.set(k, mv.next); } else if (nx.has(k)) ways.set(k, ways.get(k) + w); }
    const wins = [...nx].filter(([, s]) => won(s, level.gate));
    if (wins.length) { let c = wins[0][0]; const line = [];
      while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift(mv.act); c = p; }
      return { par: d, solutions: wins.reduce((t, [k]) => t + ways.get(k), 0), line }; }
    fr = [...nx.values()];
  }
  return { par: null, solutions: 0, line: null };
}
// a "trap" here: a first move after which the level can no longer be finished in par+2 moves
function canWin(s, level, budget, memo = new Map()) {
  if (won(s, level.gate)) return true; if (!budget) return false; const k = key(s) + '#' + budget; if (memo.has(k)) return memo.get(k);
  let ok = false; for (const mv of moves(s, level.cups, level.gate)) if (canWin(mv.next, level, budget - 1, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}
function difficulty(level, trials = 2000) {
  const sol = solve(level), start = { line: (level.line || []).slice(), floor: level.orbs.slice() }, first = moves(start, level.cups, level.gate), par = sol.par || 6;
  const traps = first.filter(mv => !canWin(mv.next, level, par + 1)).length;
  let w = 0;
  for (let t = 0; t < trials; t++) { let s = start;
    for (let i = 0; i < par + 3 && !won(s, level.gate); i++) { const ms = moves(s, level.cups, level.gate); s = ms[Math.floor(Math.random() * ms.length)].next; }
    if (won(s, level.gate)) w++; }
  return { ...sol, firstMoves: first.length, traps, randomWin: w / trials };
}
function currentLevels() {
  const i = SRC.indexOf('const QJ={'), j = SRC.indexOf('queue:[', i), k = SRC.indexOf('\n ],', j);
  return [...SRC.slice(j + 7, k).matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*(?:line:(\[[^\]]*\]),\s*)?machines:(\[[^\]]*\]),\s*gate:(\[[^\]]*\]),\s*par:(\d+)/g)]
    .map(m => ({ name: m[1], orbs: eval(m[2]), line: m[3] ? eval(m[3]) : [], cups: eval(m[4]), gate: eval(m[5]), par: +m[6] }));   // line: blobs already queuing
}
module.exports = { join, moves, solve, difficulty, currentLevels };

if (require.main === module) {
  const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
  const [cmd, parArg, countArg = '10', secsArg = '60'] = argv.filter(a => !a.startsWith('--'));
  const pad = (s, n) => String(s).padEnd(n);
  if (cmd === 'report') currentLevels().forEach((l, i) => { const d = difficulty(l);
    const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
    console.log(`${String(i + 1).padStart(2)} ${pad(l.name, 13)} par ${l.par} solver ${d.par}  optimal ${pad(d.solutions, 4)} traps ${d.traps}/${d.firstMoves}  random ${(d.randomWin * 100).toFixed(1).padStart(5)}%  ${(d.line || []).join(' > ')}${flag}`); });
  if (cmd === 'search') {
    const TARGET = +parArg, [bmin, bmax] = (flags.blobs || '3-4').split('-').map(Number);
    const CUPS = flags.cups ? [flags.cups.split(',').filter(Boolean)] : [[], ['coffee'], ['pillow'], ['coffee', 'pillow']];
    const pick = a => a[Math.floor(Math.random() * a.length)], found = new Map(), deadline = Date.now() + 1000 * +secsArg;
    while (Date.now() < deadline) {
      const n = bmin + Math.floor(Math.random() * (bmax - bmin + 1));
      const orbs = Array.from({ length: n }, () => pick('ryb') + pick('zcpe')).sort(), cups = pick(CUPS);
      // the booths: some order of exactly these blobs' colors (sometimes a free 'any' spot)
      const cols = orbs.map(t => t[0]).sort(() => Math.random() - .5), gate = cols.map(c => Math.random() < .12 ? 'any' : c);
      const k = orbs.join(' ') + '|' + cups.join() + '|' + gate.join(); if (found.has(k)) continue;
      const lvl = { orbs, cups, gate }, sol = solve(lvl, TARGET); if (sol.par !== TARGET) { found.set(k, null); continue; }
      found.set(k, { ...lvl, ...difficulty(lvl, 600) });
    }
    const best = [...found.values()].filter(Boolean).sort((a, b) => a.randomWin - b.randomWin || a.solutions - b.solutions).slice(0, +countArg);
    best.forEach(c => console.log(pad(c.orbs.join(' '), 16), pad(c.cups.join('+') || '-', 14), '->', pad(c.gate.join(','), 12), 'optimal', pad(c.solutions, 3), 'traps', c.traps + '/' + c.firstMoves, 'random', (c.randomWin * 100).toFixed(1) + '%', '|', c.line.join(' > ')));
    console.log('examined', found.size, 'hits', [...found.values()].filter(Boolean).length);
  }
}
