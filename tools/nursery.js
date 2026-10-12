// Exact solver + level search for the Nursery (hatchling rules), using the game's own gene functions.
//
//   node tools/nursery.js report                        par / solutions / traps / random-win for every Nursery level
//   node tools/nursery.js search <G|P|both> <nests> <blobs min-max> [seats min-max]   new setups, hardest first
//
// Rules modelled: only grown-ups go in a Nest (same family). Each Nest raises one clutch of four hatchlings
// (every ear/petal combination); the parents stay. When the next clutch hatches, hatchlings still on the
// floor grow up. The Cradle only takes hatchlings, by body color ('GG' = pure gold); seating is free.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const grab = re => { const m = SRC.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
const { phen, norm3 } = new Function([grab(/const alle = [^\n]+\n/), grab(/function phen\(t\)\{[^\n]+\n/), grab(/const norm3 = [^\n]+\n/)].join('') + 'return { phen, norm3 };')();

const fits = (q, t) => q === 'GG' ? t === 'G:GG' : phen(t) === q;
const kidsOf = (a, b) => { const A = a.slice(2), B = b.slice(2), l = a[0]; return [A[0] + B[0], A[0] + B[1], A[1] + B[0], A[1] + B[1]].map(x => l + ':' + norm3(l, x)); };
const sortK = a => a.slice().sort().join(' ');
// can these hatchlings fill these seats? (pure-gold seats first; plain gold seats take a non-pure gold if there is one)
function fill(h, r) {
  const pool = h.slice();
  for (const q of r.slice().sort((a, b) => (a === 'GG' ? 0 : 1) - (b === 'GG' ? 0 : 1))) {
    let i = q === 'gold' ? pool.indexOf('G:Gg') : -1; if (i < 0) i = pool.findIndex(t => fits(q, t));
    if (i < 0) return false; pool.splice(i, 1);
  }
  return true;
}
// every distinct way to seat some of the hatchlings into the remaining seats -> [seated indexes, seats left]
function seatings(h, r) {
  const out = new Map();
  const rec = (i, used, rem) => {
    if (i === h.length) { const k = sortK(used.map(j => h[j])) + '|' + sortK(rem); if (!out.has(k)) out.set(k, [used.slice(), rem.slice()]); return; }
    rec(i + 1, used, rem);
    const tried = new Set();
    rem.forEach((q, qi) => { if (tried.has(q) || !fits(q, h[i])) return; tried.add(q); const r2 = rem.slice(); r2.splice(qi, 1); rec(i + 1, used.concat(i), r2); });
  };
  rec(0, [], r); return [...out.values()];
}
// state: A grown-ups on the floor, H hatchlings on the floor, Rq empty Cradle seats, n Nests left
function moves(st) {
  const { A, H, Rq, n } = st, out = [], pairs = new Set(); if (!n) return out;
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
    const a = A[i], b = A[j]; if (a[0] !== b[0]) continue;
    const pk = [a, b].sort().join('+'); if (pairs.has(pk)) continue; pairs.add(pk);
    for (const [seated, rem] of seatings(H, Rq)) {
      const grown = H.filter((_, k) => !seated.includes(k));
      out.push({ pair: pk, seat: seated.map(k => H[k]), next: { A: A.concat(grown), H: kidsOf(a, b), Rq: rem, n: n - 1 } });
    }
  }
  return out;
}
const key = s => sortK(s.A) + '|' + sortK(s.H) + '|' + sortK(s.Rq) + '|' + s.n;
const won = s => fill(s.H, s.Rq);
const startOf = l => ({ A: l.orbs.slice(), H: [], Rq: l.gate.slice(), n: l.nests });

// BFS: par, number of optimal lines, one solution (with what to seat before each clutch)
function solve(level) {
  const start = startOf(level); if (won(start)) return { par: 0, solutions: 1, line: [] };
  const ways = new Map([[key(start), 1]]), parent = new Map(); let fr = [start], d = 0;
  while (fr.length) {
    d++; const nx = new Map();
    for (const s of fr) for (const mv of moves(s)) {
      const k = key(mv.next), w = ways.get(key(s));
      if (!ways.has(k)) { ways.set(k, w); parent.set(k, [key(s), mv]); nx.set(k, mv.next); }
      else if (nx.has(k)) ways.set(k, ways.get(k) + w);
    }
    const wins = [...nx].filter(([, s]) => won(s));
    if (wins.length) {
      let c = wins[0][0]; const line = [];
      while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift((mv.seat.length ? `seat ${mv.seat.join('+')}, ` : '') + `nest(${mv.pair})`); c = p; }
      return { par: d, solutions: wins.reduce((t, [k]) => t + ways.get(k), 0), line };
    }
    fr = [...nx.values()];
  }
  return { par: null, solutions: 0, line: null };
}
function canWin(s, memo = new Map()) {
  if (won(s)) return true; const k = key(s); if (memo.has(k)) return memo.get(k);
  let ok = false; for (const mv of moves(s)) if (canWin(mv.next, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}
// traps: first pairings after which the level can't be won at all; randomWin: random pairings + random seating
function difficulty(level, trials = 2000) {
  const start = startOf(level), sol = solve(level), ms = moves(start);
  const pairs = [...new Set(ms.map(m => m.pair))];
  const traps = pairs.filter(p => !ms.filter(m => m.pair === p).some(m => canWin(m.next))).length;
  let w = 0;
  for (let t = 0; t < trials; t++) {
    let s = start;
    while (!won(s)) {
      const all = moves(s); if (!all.length) break;
      const ps = [...new Set(all.map(m => m.pair))], p = ps[Math.floor(Math.random() * ps.length)];
      const opts = all.filter(m => m.pair === p); s = opts[Math.floor(Math.random() * opts.length)].next;
    }
    if (won(s)) w++;
  }
  return { ...sol, firstMoves: pairs.length, traps, randomWin: w / trials };
}
function currentLevels() {
  const i = SRC.indexOf('const W3 = {'), j = SRC.indexOf('levels:[', i), k = SRC.indexOf('\n  ],', j);
  return [...SRC.slice(j + 8, k).matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*machines:(\[[^\]]*\]),\s*gate:(\[[^\]]*\]),\s*par:(\d+)/g)]
    .map(m => ({ name: m[1], orbs: eval(m[2]), nests: eval(m[3]).filter(x => x === 'nest').length, gate: eval(m[4]), par: +m[5] }));
}
module.exports = { solve, difficulty, moves, won, canWin, currentLevels };

if (require.main === module) {
  const [cmd, fam, nArg, oArg = '3-5', gArg = '2-4'] = process.argv.slice(2);
  const pad = (s, n) => String(s).padEnd(n);
  if (cmd === 'report') currentLevels().forEach((l, i) => {
    const d = difficulty(l);
    const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
    console.log(`${String(i + 1).padStart(2)} ${pad(l.name, 16)} par ${l.par} solver ${d.par}  optimal ${pad(d.solutions, 3)} traps ${d.traps}/${d.firstMoves}  random ${(d.randomWin * 100).toFixed(1).padStart(5)}%  ${(d.line || []).join(' > ')}${flag}`);
  });
  if (cmd === 'search') {
    const N = +nArg, [omin, omax] = oArg.split('-').map(Number), [gmin, gmax] = gArg.split('-').map(Number);
    const TYPES = { G: ['G:GG', 'G:Gg', 'G:gg'], P: ['P:RR', 'P:RW', 'P:WW'] }, REQ = { G: ['gold', 'blue', 'GG'], P: ['red', 'pink', 'white'] };
    const T = fam === 'both' ? TYPES.G.concat(TYPES.P) : TYPES[fam], Q = fam === 'both' ? REQ.G.concat(REQ.P) : REQ[fam];
    const multis = (arr, n, from = 0) => n === 0 ? [[]] : arr.slice(from).flatMap((x, i) => multis(arr, n - 1, from + i).map(r => [x, ...r]));
    const res = [];
    for (let k = omin; k <= omax; k++) for (const orbs of multis(T, k)) for (let g = gmin; g <= gmax; g++) for (const gate of multis(Q, g)) {
      if (fam === 'both' && !(gate.some(r => REQ.P.includes(r)) && gate.some(r => REQ.G.includes(r)))) continue;
      const l = { orbs, nests: N, gate }; if (solve(l).par !== N) continue;
      const d = difficulty(l, 500); if (d.firstMoves < 3) continue;
      res.push({ l, d });
    }
    res.sort((a, b) => a.d.randomWin - b.d.randomWin);
    res.slice(0, +(process.env.TOP || 15)).forEach(({ l, d }) => console.log(pad(l.orbs.join(' '), 32), 'N' + N, '->', pad(l.gate.join(','), 24), 'optimal', pad(d.solutions, 3), 'traps', d.traps + '/' + d.firstMoves, 'random', (d.randomWin * 100).toFixed(1) + '%', '|', d.line.join(' > ')));
    console.log('found', res.length);
  }
}
