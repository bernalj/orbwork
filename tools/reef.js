// Exact solver + level search for the Reef, using the game's own food chain (EATS / hungry / bites).
//
//   node tools/reef.js report                                  par / solutions / traps / random-win for every Reef level
//   node tools/reef.js search <par> [count] [seconds] [--orbs=4-6] [--seats=3-5] [--pools=pool2,pool3]   random search
//
// Rules modelled: a Tide pool (2-4 seats in a row) fires once every seat is filled. Neighbours eat at the same
// moment: a hungry blob eats the neighbour that is its food (either side). Eaten blobs are gone, eaters become
// full. If nobody eats, nothing happens (the move is wasted, so it is never part of a solution).
// The Calm pool wants its seats filled (by species, 'any', or 'p' for a Pebble) with no hungry blob next to its food.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const grab = re => { const m = SRC.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
const { bites } = new Function([grab(/const EATS = [^\n]+\n/), grab(/const hungry = [^\n]+\n/), grab(/const bites = [^\n]+\n/)].join('') + 'return { bites };')();

const HOLES = { pool2: 2, pool3: 3, pool4: 4 };
const sortK = a => a.slice().sort().join(' ');
function fire(ts) {
  const eaten = new Set(), full = new Set();
  for (let i = 0; i < ts.length - 1; i++) for (const [x, y] of [[i, i + 1], [i + 1, i]]) if (bites(ts[x], ts[y])) { eaten.add(y); full.add(x); }
  if (!eaten.size) return null;
  return ts.map((t, i) => eaten.has(i) ? null : full.has(i) ? t[0] + 'f' : t).filter(Boolean);
}
// ordered k-tuples of distinct blobs (deduped by what they are)
function tuples(state, k) {
  const out = [], seen = new Set();
  const rec = (used, cur) => { if (cur.length === k) { const sig = cur.map(i => state[i]).join(','); if (!seen.has(sig)) { seen.add(sig); out.push(cur.slice()); } return; }
    for (let i = 0; i < state.length; i++) if (!used.has(i)) { used.add(i); cur.push(i); rec(used, cur); cur.pop(); used.delete(i); } };
  rec(new Set(), []); return out;
}
function moves(state, pools) {
  const out = [], seen = new Set();
  for (const m of new Set(pools)) for (const c of tuples(state, HOLES[m])) {
    const ins = c.map(i => state[i]), res = fire(ins); if (!res) continue;
    const next = state.filter((_, i) => !c.includes(i)).concat(res), k = sortK(next);
    if (seen.has(m + k)) continue; seen.add(m + k);
    out.push({ pool: m, inputs: ins, next });
  }
  return out;
}
const fits = (q, t) => q === 'any' || t[0] === q;
// can the Calm pool be filled? (seats in order, distinct blobs, no bites between neighbours)
function calmOK(state, gate) {
  const used = new Array(state.length).fill(false), row = [];
  const rec = i => { if (i === gate.length) return true; const tried = new Set();
    for (let k = 0; k < state.length; k++) { const t = state[k]; if (used[k] || tried.has(t) || !fits(gate[i], t)) continue; tried.add(t);
      if (i && (bites(row[i - 1], t) || bites(t, row[i - 1]))) continue;
      used[k] = true; row[i] = t; if (rec(i + 1)) return true; used[k] = false; }
    return false; };
  return rec(0);
}
function solve(level, maxDepth = 8) {
  const { orbs, pools, gate } = level, start = orbs.slice(); if (calmOK(start, gate)) return { par: 0, solutions: 1, line: [] };
  const ways = new Map([[sortK(start), 1]]), parent = new Map(); let fr = [start];
  for (let d = 1; d <= maxDepth && fr.length; d++) {
    const nx = new Map();
    for (const s of fr) for (const mv of moves(s, pools)) { const k = sortK(mv.next), w = ways.get(sortK(s));
      if (!ways.has(k)) { ways.set(k, w); parent.set(k, [sortK(s), mv]); nx.set(k, mv.next); } else if (nx.has(k)) ways.set(k, ways.get(k) + w); }
    const wins = [...nx].filter(([, s]) => calmOK(s, gate));
    if (wins.length) { let c = wins[0][0]; const line = [];
      while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift(`${mv.pool}(${mv.inputs.join(',')})`); c = p; }
      return { par: d, solutions: wins.reduce((t, [k]) => t + ways.get(k), 0), line }; }
    fr = [...nx.values()];
  }
  return { par: null, solutions: 0, line: null };
}
function canWin(s, pools, gate, budget, memo = new Map()) {
  if (calmOK(s, gate)) return true; if (!budget) return false; const k = sortK(s) + '#' + budget; if (memo.has(k)) return memo.get(k);
  let ok = false; for (const mv of moves(s, pools)) if (canWin(mv.next, pools, gate, budget - 1, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}
function difficulty(level, trials = 2000) {
  const sol = solve(level), first = moves(level.orbs, level.pools), limit = (sol.par || 5) + 3;
  const traps = first.filter(mv => !canWin(mv.next, level.pools, level.gate, 7)).length;
  let w = 0;
  for (let t = 0; t < trials; t++) { let s = level.orbs.slice();
    for (let i = 0; i < limit && !calmOK(s, level.gate); i++) { const ms = moves(s, level.pools); if (!ms.length) break; s = ms[Math.floor(Math.random() * ms.length)].next; }
    if (calmOK(s, level.gate)) w++; }
  return { ...sol, firstMoves: first.length, traps, randomWin: w / trials };
}
function currentLevels() {
  const i = SRC.indexOf('const W4 = {'), j = SRC.indexOf('levels:[', i), k = SRC.indexOf('\n  ],', j);
  return [...SRC.slice(j + 8, k).matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*machines:(\[[^\]]*\]),\s*gate:(\[[^\]]*\]),\s*par:(\d+)/g)]
    .map(m => ({ name: m[1], orbs: eval(m[2]), pools: eval(m[3]), gate: eval(m[4]), par: +m[5] }));
}
module.exports = { fire, moves, calmOK, solve, difficulty, currentLevels };

if (require.main === module) {
  const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
  const [cmd, parArg, countArg = '10', secsArg = '60'] = argv.filter(a => !a.startsWith('--'));
  const pad = (s, n) => String(s).padEnd(n);
  if (cmd === 'report') currentLevels().forEach((l, i) => { const d = difficulty(l);
    const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
    console.log(`${String(i + 1).padStart(2)} ${pad(l.name, 15)} par ${l.par} solver ${d.par}  optimal ${pad(d.solutions, 4)} traps ${d.traps}/${d.firstMoves}  random ${(d.randomWin * 100).toFixed(1).padStart(5)}%  ${(d.line || []).join(' > ')}${flag}`); });
  if (cmd === 'search') {
    const TARGET = +parArg, range = (v, d) => (v || d).split('-').map(Number), [omin, omax] = range(flags.orbs, '4-6'), [smin, smax] = range(flags.seats, '3-5');
    const POOLS = flags.pools ? [flags.pools.split(',')] : [['pool2'], ['pool3'], ['pool2', 'pool3'], ['pool4'], ['pool2', 'pool4']];
    const pick = a => a[Math.floor(Math.random() * a.length)], BAG = ['sh', 'sh', 'jh', 'jh', 'gh', 'gh', 'sf', 'jf', 'gf', 'pe'];
    const found = new Map(), deadline = Date.now() + 1000 * +secsArg;
    while (Date.now() < deadline) {
      const orbs = Array.from({ length: omin + Math.floor(Math.random() * (omax - omin + 1)) }, () => pick(BAG)).sort();
      const n = smin + Math.floor(Math.random() * (smax - smin + 1)); if (n > orbs.length) continue;
      const gate = Array.from({ length: n }, () => pick(['s', 's', 'j', 'j', 'g', 'g', 'any', 'p'])), pools = pick(POOLS);
      const k = orbs.join(' ') + '|' + pools.join() + '|' + gate.join(); if (found.has(k)) continue;
      const sol = solve({ orbs, pools, gate }, TARGET); if (sol.par !== TARGET) { found.set(k, null); continue; }
      found.set(k, { orbs, pools, gate, ...difficulty({ orbs, pools, gate }, 600) });
    }
    const best = [...found.values()].filter(Boolean).sort((a, b) => a.randomWin - b.randomWin || a.solutions - b.solutions).slice(0, +countArg);
    best.forEach(c => console.log(pad(c.orbs.join(' '), 24), pad(c.pools.join('+'), 12), '->', pad(c.gate.join(','), 18), 'optimal', pad(c.solutions, 4), 'traps', c.traps + '/' + c.firstMoves, 'random', (c.randomWin * 100).toFixed(1) + '%', '|', c.line.join(' > ')));
    console.log('examined', found.size, 'hits', [...found.values()].filter(Boolean).length);
  }
}
