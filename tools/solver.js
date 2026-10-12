// Exact solver for Hatchery, Commons and Lighthouse levels, using the game's own rule functions
// (pulled out of index.html at load, so it can't drift from the game).
//
//   node tools/solver.js report            par / solutions / traps / random-win for every level
//   (also required as a module by tools/levelgen.js)
//
// Model: a state is the multiset of blobs on the board. A move is firing one machine with
// some of those blobs (failed firings cost a move but change nothing, so they're never useful).
// A level is solved once the board holds every blob the goal machine asks for.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');   // Git may check it out with CRLF
const grab = re => { const m = SRC.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
// rule code, evaluated in an isolated function scope
const rulesCode = [
  grab(/const kindOf = [^\n]+\n/), grab(/const tier = [^\n]+\n/),
  grab(/function react1\(a,b\)\{[\s\S]*?\n\}\n/),
  grab(/const norm=[^\n]+\n/), grab(/function lightReact\(mt, ts\)\{[\s\S]*?\n\}\n/),
  grab(/const along = [^\n]+\n/),
  grab(/const alle = [^\n]+\n/), grab(/function phen\(t\)\{[^\n]+\n/), grab(/const norm3 = [^\n]+\n/),
].join('');
const { react1, lightReact, along, alle, phen, norm3 } = new Function(rulesCode + 'return { react1, lightReact, along, alle, phen, norm3 };')();

// Nursery: a Nest takes two parents of the same family; they stay, and a clutch of four babies
// (every ear/petal combination) joins them. Each Nest raises one clutch, so a level's Nests are
// 'N' tokens in the state: firing a Nest spends one.
// Babies carry a '~' suffix; a baby who goes into a Nest comes out grown up.
const CRADLE_BABIES = process.env.CRADLE === 'babies' || /\/\* cradle: babies only \*\//.test(SRC);
const adult = t => t.replace('~', '');
function nurseryFire(m, ts) {
  const [a, b] = ts.map(adult); if (ts.includes('N') || a[0] !== b[0]) return null;
  const A = alle(a), B = alle(b), line = a[0];
  return [a, b, ...[A[0] + B[0], A[0] + B[1], A[1] + B[0], A[1] + B[1]].map(x => line + ':' + norm3(line, x) + '~')];
}
// Cradle: every seat filled by body color; 'GG' (pure gold) needs two gold ears
function cradleOK(state, gate) {
  const c = {}; state.forEach(t => { if (t !== 'N' && (!CRADLE_BABIES || t.endsWith('~'))) c[adult(t)] = (c[adult(t)] || 0) + 1; });   // babies-only Cradle: grown-ups don't count
  const n = t => c[t] || 0, need = r => gate.filter(g => g === r).length;
  const pure = n('G:GG') - need('GG');
  return pure >= 0 && need('gold') <= n('G:Gg') + pure && need('blue') <= n('G:gg')
    && need('red') <= n('P:RR') && need('pink') <= n('P:RW') && need('white') <= n('P:WW');
}

// Commons: the Meeting spot and Campfire exactly as W2.react does them (transform only, nothing consumed)
function commonsFire(m, ts) {
  if (m === 'meet') { const [a, b] = ts; if (a[1] === 'g' && b[1] === 'g') return null;
    return along(a[0], b[0]) ? [a[0] + 'h', b[0] + 'h'] : [a[0] + 'g', b[0] + 'g']; }
  if (m === 'camp') { const mood = ts.filter(t => t[1] === 'h').length >= 2 ? 'h' : 'g'; return ts.map(t => t[0] + mood); }
  return null;
}
// Friendship bench: can some of these blobs fill every free seat? (all happy, seat colors honored,
// guests already seated, and no Red next to a Blue)
// "Moods spread" bench: when it fills, a blob between two happy neighbours cheers up, a blob between
// two grumpy neighbours sulks, everyone else (ends included) keeps their mood. Then all must be happy,
// and no Red may sit next to a Blue. Grumpy blobs may sit.
function spreadOK(row) {
  for (let i = 0; i < row.length; i++) {
    let m = row[i][1];
    if (i > 0 && i < row.length - 1 && row[i - 1][1] === row[i + 1][1]) m = row[i - 1][1];
    if (m !== 'h') return false;
  }
  return true;
}
function benchSpreadOK(state, gate) {
  const seats = gate.map(g => g.startsWith('L:') ? { fixed: g.slice(2) } : { req: g });
  const free = seats.filter(x => !x.fixed).length;
  if (state.length < free) return false;
  const row = seats.map(x => x.fixed || null), used = new Array(state.length).fill(false);
  const ok = i => { if (i === row.length) return spreadOK(row);
    if (seats[i].fixed) return (i === 0 || along(row[i - 1][0], row[i][0])) && ok(i + 1);
    const tried = new Set();
    for (let k = 0; k < state.length; k++) { const t = state[k];
      if (used[k] || tried.has(t)) continue; tried.add(t);
      if (seats[i].req !== 'any' && t[0] !== seats[i].req) continue;
      if (i > 0 && !along(row[i - 1][0], t[0])) continue;
      if (i + 1 < row.length && seats[i + 1].fixed && !along(t[0], seats[i + 1].fixed[0])) continue;
      used[k] = true; row[i] = t; if (ok(i + 1)) return true; used[k] = false; row[i] = null; }
    return false; };
  return ok(0);
}
function benchOK(state, gate) {
  const seats = gate.map(g => g.startsWith('L:') ? { fixed: g.slice(2) } : { req: g });
  const happy = state.filter(t => t[1] === 'h');
  const free = seats.filter(x => !x.fixed).length;
  if (happy.length < free) return false;
  const row = seats.map(x => x.fixed || null), used = new Array(happy.length).fill(false);
  const ok = i => { if (i === row.length) return true;
    if (seats[i].fixed) return (i === 0 || along(row[i - 1][0], row[i][0])) && ok(i + 1);
    const tried = new Set();
    for (let k = 0; k < happy.length; k++) { const t = happy[k];
      if (used[k] || tried.has(t)) continue; tried.add(t);
      if (seats[i].req !== 'any' && t[0] !== seats[i].req) continue;
      if (i > 0 && !along(row[i - 1][0], t[0])) continue;
      if (i + 1 < row.length && seats[i + 1].fixed && !along(t[0], seats[i + 1].fixed[0])) continue;
      used[k] = true; row[i] = t; if (ok(i + 1)) return true; used[k] = false; row[i] = null; }
    return false; };
  return ok(0);
}

const HOLES = { press: 2, lamp: 2, prism: 1, filter: 2, meet: 2, camp: 3, nest: 2 };
const WORLD = {
  hatchery: { machines: ['press'], fire: (m, ts) => { const r = react1(ts[0], ts[1]); return r.fail ? null : r.out; } },
  nursery: { machines: ['nest'], fire: nurseryFire, goal: cradleOK, spends: 'N' },
  commons: { machines: ['meet', 'camp'], fire: commonsFire, goal: (s, g) => (process.env.BENCH === 'spread' ? benchSpreadOK : benchOK)(s, g) },
  lighthouse: { machines: ['lamp', 'prism', 'filter'], fire: (m, ts) => {
    const r = lightReact(m, ts); if (r.fail) return null;
    return r.consume ? r.spawn : r.transform.filter(Boolean); } },
};

const key = ms => ms.slice().sort().join(' ');
const contains = (ms, need) => { const c = {}; ms.forEach(t => c[t] = (c[t] || 0) + 1); return need.every(t => c[t]-- > 0); };
// is this state a win? (Commons: the bench can be seated; others: the board holds every goal blob)
const won = (world, state, gate) => WORLD[world].goal ? WORLD[world].goal(state, gate) : contains(state, gate.filter(g => !g.startsWith('L:')));

// every successful firing from a state: [{machine, inputs, next}]
function moves(world, machines, state) {
  const out = [], seen = new Set();
  for (const m of new Set(machines)) {
    const k = HOLES[m];
    const idx = state.map((_, i) => i);
    const combos = k === 1 ? idx.map(i => [i]) : k === 2 ? idx.flatMap(i => idx.filter(j => j > i).map(j => [i, j]))
      : idx.flatMap(i => idx.filter(j => j > i).flatMap(j => idx.filter(l => l > j).map(l => [i, j, l])));
    for (const c of combos) {
      const ins = c.map(i => state[i]), sig = m + ':' + ins.slice().sort().join('+');
      if (seen.has(sig)) continue; seen.add(sig);
      const res = WORLD[world].fire(m, ins);
      if (!res) continue;
      const rest = state.filter((_, i) => !c.includes(i)), sp = WORLD[world].spends;
      if (sp) { const j = rest.indexOf(sp); if (j < 0) continue; rest.splice(j, 1); }   // uses up a Nest
      out.push({ machine: m, inputs: ins, next: rest.concat(res) });
    }
  }
  return out;
}

// BFS from the start: par, number of optimal move sequences, dead ends, and the solution(s)
function solve(level, maxDepth = 9) {
  const { world, orbs, machines, gate } = level;
  const start = orbs.slice(), win = s => won(world, s, gate);
  const dist = new Map([[key(start), 0]]), ways = new Map([[key(start), 1]]), node = new Map([[key(start), start]]);
  const parent = new Map(); let frontier = [start], par = null;
  if (win(start)) par = 0;
  for (let d = 0; d < maxDepth && par === null && frontier.length; d++) {
    const next = [];
    for (const s of frontier) for (const mv of moves(world, machines, s)) {
      const k = key(mv.next), w = ways.get(key(s));
      if (!dist.has(k)) { dist.set(k, d + 1); ways.set(k, w); node.set(k, mv.next); parent.set(k, [key(s), mv]); next.push(mv.next); }
      else if (dist.get(k) === d + 1) ways.set(k, ways.get(k) + w);
    }
    for (const s of next) if (win(s)) { par = d + 1; break; }
    frontier = next;
  }
  let solutions = 0, line = null;
  if (par !== null) for (const [k, s] of node) if (dist.get(k) === par && win(s)) {
    solutions += ways.get(k);
    if (!line) { line = []; let c = k; while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift(`${mv.machine}(${mv.inputs.join('+')})`); c = p; } }
  }
  return { par, solutions, line };
}

// Can the goal still be reached from this state? (memoised DFS with a move budget)
function solvable(world, machines, state, gate, budget, memo = new Map()) {
  if (won(world, state, gate)) return true;
  if (budget === 0) return false;
  const k = key(state) + '#' + budget;
  if (memo.has(k)) return memo.get(k);
  let ok = false;
  for (const mv of moves(world, machines, state)) if (solvable(world, machines, mv.next, gate, budget - 1, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}

// How punishing is the level? traps = first moves after which it's no longer solvable at all;
// randomWin = chance a player making random successful firings wins within par+3 firings.
function difficulty(level, trials = 4000) {
  const { world, orbs, machines, gate } = level;
  const first = moves(world, machines, orbs);
  const traps = first.filter(mv => !solvable(world, machines, mv.next, gate, 8)).length;
  const sol = solve(level), limit = (sol.par || 6) + 3;
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    let s = orbs.slice();
    for (let i = 0; i < limit; i++) {
      if (won(world, s, gate)) break;
      const ms = moves(world, machines, s); if (!ms.length) break;
      s = ms[Math.floor(Math.random() * ms.length)].next;
    }
    if (won(world, s, gate)) wins++;
  }
  // blobs never touched by any optimal solution are decoys (computed from the sample solution)
  return { ...sol, firstMoves: first.length, traps, randomWin: wins / trials };
}

// ---- levels as they are in the game right now ----
function currentLevels() {
  const block = (name) => { const i = SRC.indexOf(`const ${name} = {`); const j = SRC.indexOf('levels:[', i); const k = SRC.indexOf('\n  ],', j); return SRC.slice(j + 8, k); };
  const parse = (txt, world) => [...txt.matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*(?:machines:(\[[^\]]*\]),\s*)?gate:(\[[^\]]*\]),\s*par:(\d+)/g)]
    .map(m => ({ world, name: m[1], orbs: eval(m[2]), machines: m[3] ? eval(m[3]) : ['press'], gate: eval(m[4]), par: +m[5] }));
  // Nursery: each Nest on the board becomes an 'N' token (one clutch each)
  const nursery = parse(block('W3'), 'nursery').map(l => ({ ...l, orbs: l.orbs.concat(l.machines.filter(m => m === 'nest').map(() => 'N')), machines: ['nest'] }));
  return { hatchery: parse(block('W1'), 'hatchery'), commons: parse(block('W2'), 'commons'), nursery, lighthouse: parse(block('WL'), 'lighthouse') };
}

module.exports = { react1, lightReact, along, commonsFire, nurseryFire, cradleOK, CRADLE_BABIES, phen, benchOK, benchSpreadOK, spreadOK, won, moves, solve, solvable, difficulty, currentLevels, WORLD, HOLES, contains, key };

if (require.main === module && process.argv[2] === 'report') {
  const lv = currentLevels();
  for (const w of ['hatchery', 'commons', 'nursery', 'lighthouse']) {
    console.log(`\n== ${w} (${lv[w].length} levels)`);
    console.log('  #  name                  par  solver  optimal-paths  first-moves  traps  random-win  solution');
    lv[w].forEach((l, i) => {
      const d = difficulty(l);
      const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
      console.log(`  ${String(i + 1).padStart(2)} ${l.name.padEnd(21)} ${String(l.par).padStart(3)}  ${String(d.par).padStart(6)}  ${String(d.solutions).padStart(13)}  ${String(d.firstMoves).padStart(11)}  ${String(d.traps).padStart(5)}  ${(d.randomWin * 100).toFixed(0).padStart(9)}%  ${(d.line || []).join(' → ')}${flag}`);
    });
  }
}
