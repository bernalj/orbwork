// Level generator: samples random setups and keeps the ones that hit a difficulty target.
//   node tools/levelgen.js <hatchery|lighthouse> <par> [count] [seconds] [--uses=sp,vo] [--gate=1-3] [--orbs=3-6] [--machines=lamp,prism]
//     --uses      blob kinds the solution must feed into a machine (e.g. sp,vo / glass)
//     --gate      goal size range; --orbs starting blob count range; --machines fixed machine set (Lighthouse)
// Prints JSON candidates sorted best-first: start blobs, machines, goal, par, number of optimal
// solutions, traps (first moves that make the level unsolvable), random-win rate, decoys.
'use strict';
const { moves, solve, solvable, contains, key } = require('./solver');

const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const [world, parArg, countArg = '8', secsArg = '60'] = argv.filter(a => !a.startsWith('--'));
const range = (v, d) => (v || d).split('-').map(Number).concat([]).slice(0, 2).map((x, i, a) => x ?? a[0]);
const [GMIN, GMAX = GMIN] = range(flags.gate, '1-3'), [OMIN, OMAX = OMIN] = range(flags.orbs, world === 'hatchery' ? '3-6' : '3-5');
const USES = flags.uses ? flags.uses.split(',') : [], FIXED_M = flags.machines ? flags.machines.split(',') : null;
const TARGET = +parArg, WANT = +countArg, DEADLINE = Date.now() + 1000 * +secsArg;
const pick = a => a[Math.floor(Math.random() * a.length)];
const LIGHTS = ['r', 'g', 'b', 'rg', 'rb', 'gb', 'rgb'];

function sampleSetup() {
  if (world === 'hatchery') {
    const n = OMIN + Math.floor(Math.random() * (OMAX - OMIN + 1));
    const bag = ['p1', 'p1', 'p1', 'p2', 'p2', 'p3', 'p3', 'p4', 'tw', 'tw', 'sp', 'vo', 'wi', 'wi'];
    return { orbs: Array.from({ length: n }, () => pick(bag)), machines: ['press'] };
  }
  const n = OMIN + Math.floor(Math.random() * (OMAX - OMIN + 1));  // up to 2 of them glass
  const orbs = Array.from({ length: n }, () => 'L' + pick(LIGHTS));
  const glass = FIXED_M && !FIXED_M.includes('filter') ? 0 : Math.random() < .6 ? 1 + (Math.random() < .3) : 0;   // no glass without a Filter
  for (let i = 0; i < glass; i++) orbs[i] = 'F' + pick(['r', 'g', 'b', 'rg', 'rb', 'gb']);
  if (FIXED_M && FIXED_M.includes('filter') && !glass) orbs[0] = 'F' + pick(['r', 'g', 'b', 'rg', 'rb', 'gb']);
  const machines = FIXED_M || ['lamp', 'prism', 'filter'].filter(m => (m !== 'filter' || glass) && Math.random() < .75);
  return { orbs, machines: machines.length ? machines : ['lamp'] };
}

// From a start, find goals (1-3 blobs) whose cheapest solution is exactly TARGET firings.
function goalsAt(setup) {
  const depth = new Map([[key(setup.orbs), 0]]), states = [setup.orbs]; let frontier = [setup.orbs];
  for (let d = 0; d < TARGET && frontier.length; d++) {
    const next = [];
    for (const s of frontier) for (const mv of moves(world, setup.machines, s)) { const k = key(mv.next); if (!depth.has(k)) { depth.set(k, d + 1); next.push(mv.next); states.push(mv.next); } }
    frontier = next; if (states.length > 20000) return [];
  }
  const goalOK = t => world === 'hatchery' ? /^p[2-6]$/.test(t) : t[0] === 'L';
  const best = new Map();                                            // goal multiset -> cheapest depth
  for (const s of states) {
    const d = depth.get(key(s)), toks = s.filter(goalOK);
    const subs = new Set();
    for (let i = 0; i < toks.length; i++) { subs.add(toks[i]); for (let j = i + 1; j < toks.length; j++) { subs.add([toks[i], toks[j]].sort().join(' ')); for (let k = j + 1; k < toks.length; k++) subs.add([toks[i], toks[j], toks[k]].sort().join(' ')); } }
    for (const g of subs) if (!best.has(g) || best.get(g) > d) best.set(g, d);
  }
  return [...best].filter(([, d]) => d === TARGET).map(([g]) => g.split(' '));
}

function rate(level, trials = 600) {
  const goal = level.gate, sol = solve(level);
  if (sol.par !== TARGET) return null;
  const fed = (sol.line || []).join(' ');
  if (USES.some(u => u === 'glass' ? !/\+F|\(F/.test(fed) : u === 'machines' ? !level.machines.every(m => fed.includes(m + '(')) : !fed.includes(u))) return null;
  const first = moves(world, level.machines, level.orbs);
  const traps = first.filter(mv => !solvable(world, level.machines, mv.next, goal, TARGET + 2)).length;
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    let s = level.orbs.slice();
    for (let i = 0; i < TARGET + 3 && !contains(s, goal); i++) { const ms = moves(world, level.machines, s); if (!ms.length) break; s = pick(ms).next; }
    if (contains(s, goal)) wins++;
  }
  // decoys: starting blobs the sample solution never feeds into a machine
  const used = []; (sol.line || []).forEach(step => step.replace(/^\w+\(|\)$/g, '').split('+').forEach(t => used.push(t)));
  const pool = level.orbs.slice(); used.forEach(t => { const i = pool.indexOf(t); if (i >= 0) pool.splice(i, 1); });
  const decoys = pool.filter(t => !goal.includes(t)).length;
  const kinds = new Set(level.orbs.map(t => world === 'hatchery' ? (t[0] === 'p' ? 'pip' : t) : t[0] + t.length)).size;
  // score: rare to stumble into, has traps, few optimal lines, some decoys, uses variety
  const score = (1 - wins / trials) * 4 + Math.min(traps, 3) * .8 + (sol.solutions <= 2 ? 1.5 : sol.solutions <= 6 ? .6 : 0) + Math.min(decoys, 2) * .5 + kinds * .3 - level.orbs.length * .15;
  return { ...level, par: sol.par, solutions: sol.solutions, firstMoves: first.length, traps, randomWin: +(wins / trials).toFixed(3), decoys, score: +score.toFixed(2), solution: sol.line };
}

const found = new Map();
while (Date.now() < DEADLINE) {
  const setup = sampleSetup();
  for (const gate of goalsAt(setup).slice(0, 6)) {
    if (setup.machines.length > 3 || gate.length < GMIN || gate.length > GMAX) continue;
    const lvl = { world, orbs: setup.orbs.slice().sort(), machines: setup.machines, gate };
    const k = key(lvl.orbs) + '|' + lvl.machines.join() + '|' + key(gate);
    if (found.has(k)) continue;
    const r = rate(lvl); if (r) found.set(k, r);
  }
}
// one candidate per solution shape (which machines/kinds are used, in order), so the list isn't near-copies
const shape = c => (c.solution || []).map(st => st.replace(/p\d/g, 'p').replace(/L[rgb]+/g, 'L').replace(/F[rgb]+/g, 'F')).join('>') + '|' + c.gate.length;
const seenShape = new Set(), best = [];
for (const c of [...found.values()].sort((a, b) => b.score - a.score)) { if (seenShape.has(shape(c))) continue; seenShape.add(shape(c)); best.push(c); if (best.length >= WANT) break; }
console.log(JSON.stringify({ world, par: TARGET, examined: found.size, best }, null, 1));
