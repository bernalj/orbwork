// Exact solver for Hatchery and Lighthouse levels, using the game's own rule functions
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

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = re => { const m = SRC.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };
// rule code, evaluated in an isolated function scope
const rulesCode = [
  grab(/const kindOf = [^\n]+\n/), grab(/const tier = [^\n]+\n/),
  grab(/function react1\(a,b\)\{[\s\S]*?\n\}\n/),
  grab(/const norm=[^\n]+\n/), grab(/function lightReact\(mt, ts\)\{[\s\S]*?\n\}\n/),
].join('');
const { react1, lightReact } = new Function(rulesCode + 'return { react1, lightReact };')();

const HOLES = { press: 2, lamp: 2, prism: 1, filter: 2 };
const WORLD = {
  hatchery: { machines: ['press'], fire: (m, ts) => { const r = react1(ts[0], ts[1]); return r.fail ? null : r.out; } },
  lighthouse: { machines: ['lamp', 'prism', 'filter'], fire: (m, ts) => {
    const r = lightReact(m, ts); if (r.fail) return null;
    return r.consume ? r.spawn : r.transform.filter(Boolean); } },
};

const key = ms => ms.slice().sort().join(' ');
const contains = (ms, need) => { const c = {}; ms.forEach(t => c[t] = (c[t] || 0) + 1); return need.every(t => c[t]-- > 0); };

// every successful firing from a state: [{machine, inputs, next}]
function moves(world, machines, state) {
  const out = [], seen = new Set();
  for (const m of new Set(machines)) {
    const k = HOLES[m];
    const idx = state.map((_, i) => i);
    const combos = k === 1 ? idx.map(i => [i]) : idx.flatMap(i => idx.filter(j => j > i).map(j => [i, j]));
    for (const c of combos) {
      const ins = c.map(i => state[i]), sig = m + ':' + ins.slice().sort().join('+');
      if (seen.has(sig)) continue; seen.add(sig);
      const res = WORLD[world].fire(m, ins);
      if (!res) continue;
      const rest = state.filter((_, i) => !c.includes(i));
      out.push({ machine: m, inputs: ins, next: rest.concat(res) });
    }
  }
  return out;
}

// BFS from the start: par, number of optimal move sequences, dead ends, and the solution(s)
function solve(level, maxDepth = 9) {
  const { world, orbs, machines, gate } = level;
  const start = orbs.slice(), goal = gate.filter(g => !g.startsWith('L:'));
  const dist = new Map([[key(start), 0]]), ways = new Map([[key(start), 1]]), node = new Map([[key(start), start]]);
  const parent = new Map(); let frontier = [start], par = null;
  if (contains(start, goal)) par = 0;
  for (let d = 0; d < maxDepth && par === null && frontier.length; d++) {
    const next = [];
    for (const s of frontier) for (const mv of moves(world, machines, s)) {
      const k = key(mv.next), w = ways.get(key(s));
      if (!dist.has(k)) { dist.set(k, d + 1); ways.set(k, w); node.set(k, mv.next); parent.set(k, [key(s), mv]); next.push(mv.next); }
      else if (dist.get(k) === d + 1) ways.set(k, ways.get(k) + w);
    }
    for (const s of next) if (contains(s, goal)) { par = d + 1; break; }
    frontier = next;
  }
  let solutions = 0, line = null;
  if (par !== null) for (const [k, s] of node) if (dist.get(k) === par && contains(s, goal)) {
    solutions += ways.get(k);
    if (!line) { line = []; let c = k; while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift(`${mv.machine}(${mv.inputs.join('+')})`); c = p; } }
  }
  return { par, solutions, line };
}

// Can the goal still be reached from this state? (memoised DFS with a move budget)
function solvable(world, machines, state, goal, budget, memo = new Map()) {
  if (contains(state, goal)) return true;
  if (budget === 0) return false;
  const k = key(state) + '#' + budget;
  if (memo.has(k)) return memo.get(k);
  let ok = false;
  for (const mv of moves(world, machines, state)) if (solvable(world, machines, mv.next, goal, budget - 1, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}

// How punishing is the level? traps = first moves after which it's no longer solvable at all;
// randomWin = chance a player making random successful firings wins within par+3 firings.
function difficulty(level, trials = 4000) {
  const { world, orbs, machines, gate } = level, goal = gate.filter(g => !g.startsWith('L:'));
  const first = moves(world, machines, orbs);
  const traps = first.filter(mv => !solvable(world, machines, mv.next, goal, 8)).length;
  const sol = solve(level), limit = (sol.par || 6) + 3;
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    let s = orbs.slice();
    for (let i = 0; i < limit; i++) {
      if (contains(s, goal)) break;
      const ms = moves(world, machines, s); if (!ms.length) break;
      s = ms[Math.floor(Math.random() * ms.length)].next;
    }
    if (contains(s, goal)) wins++;
  }
  // blobs never touched by any optimal solution are decoys (computed from the sample solution)
  return { ...sol, firstMoves: first.length, traps, randomWin: wins / trials };
}

// ---- levels as they are in the game right now ----
function currentLevels() {
  const block = (name) => { const i = SRC.indexOf(`const ${name} = {`); const j = SRC.indexOf('levels:[', i); const k = SRC.indexOf('\n  ],', j); return SRC.slice(j + 8, k); };
  const parse = (txt, world) => [...txt.matchAll(/\{name:'([^']+)',\s*orbs:(\[[^\]]*\]),\s*(?:machines:(\[[^\]]*\]),\s*)?gate:(\[[^\]]*\]),\s*par:(\d+)/g)]
    .map(m => ({ world, name: m[1], orbs: eval(m[2]), machines: m[3] ? eval(m[3]) : ['press'], gate: eval(m[4]), par: +m[5] }));
  return { hatchery: parse(block('W1'), 'hatchery'), lighthouse: parse(block('WL'), 'lighthouse') };
}

module.exports = { react1, lightReact, moves, solve, solvable, difficulty, currentLevels, WORLD, HOLES, contains, key };

if (require.main === module && process.argv[2] === 'report') {
  const lv = currentLevels();
  for (const w of ['hatchery', 'lighthouse']) {
    console.log(`\n== ${w} (${lv[w].length} levels)`);
    console.log('  #  name                  par  solver  optimal-paths  first-moves  traps  random-win  solution');
    lv[w].forEach((l, i) => {
      const d = difficulty(l);
      const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
      console.log(`  ${String(i + 1).padStart(2)} ${l.name.padEnd(21)} ${String(l.par).padStart(3)}  ${String(d.par).padStart(6)}  ${String(d.solutions).padStart(13)}  ${String(d.firstMoves).padStart(11)}  ${String(d.traps).padStart(5)}  ${(d.randomWin * 100).toFixed(0).padStart(9)}%  ${(d.line || []).join(' → ')}${flag}`);
    });
  }
}
