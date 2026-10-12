// Exact solver + level search for Remix levels, using the game's own remix engine (rxReact / rxMatch / rxValidate / qJoin).
//
//   node tools/remix.js report                     par / solutions / traps / random-win for every remix level
//   node tools/remix.js search <world> <par> [count] [seconds]     random search around a world's traits (commons|nursery|reef|queue)
//
// Model: a move is firing a machine (Press, Meeting spot, Campfire, Nest, Tide pool, Coffee, Pillow) or, for a Ticket line,
// dropping a blob into the line. Nests raise one clutch each; only grown-ups nest; a clutch hatches as hatchlings and the
// hatchlings still on the floor grow up when the next clutch hatches. A Cradle only takes hatchlings (seating is free, any
// time); a Bench / Calm pool can be filled from the floor at any time. Tokens are the game's trait strings ('*c=r,e=2,m=h'),
// with '~' appended for a hatchling.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SOLVER_SRC || path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return SRC.slice(i, j); };
const code = [
  between('const QJ={', '\n ]};') + '\n ]};\n',
  between('const Q_UP=', '\n') + '\n',
  between('function qJoin(line, o){', '\n}\n') + '\n}\n',
  between('const RXP = ', 'const RXL = {'),
  between('const RXL = {', '\n};\n') + '\n};\n',
].join('');
const E = new Function('S', 'learn', code + 'return { RXP, RXF, rxReact, rxMatch, rxValidate, rxColor, qJoin, RXL };')({ aff: {}, food: {} }, () => {});
const { RXP, RXF, rxReact, rxMatch, rxValidate, qJoin, RXL } = E;

const HOLES = { press: 2, meet: 2, camp: 3, nest: 2, pool2: 2, pool3: 3, pool4: 4, coffee: 1, pillow: 1 };
const baby = t => t.endsWith('~'), plain = t => baby(t) ? t.slice(0, -1) : t;
const sortK = a => a.slice().sort().join(' ');
const key = s => sortK(s.floor) + '|' + s.line.join(',') + '|' + s.nests + '|' + sortK(s.cradle);

// seat these floor tokens into these seats (order matters, distinct blobs) so the gate validates
function seatable(tokens, seats, kind) {
  const used = new Array(tokens.length).fill(false), row = [];
  const rec = i => { if (i === seats.length) return rxValidate(kind, row).ok;
    const tried = new Set();
    for (let k = 0; k < tokens.length; k++) { const t = tokens[k]; if (used[k] || tried.has(t)) continue; tried.add(t);
      const o = RXP(plain(t)); if (!rxMatch(seats[i], o)) continue;
      used[k] = true; row[i] = o; if (rec(i + 1)) return true; used[k] = false; }
    return false; };
  return rec(0);
}
// ways to seat some hatchlings in the Cradle right now -> [{seated tokens, seats left}]
function cradleChoices(floor, seats) {
  const hs = floor.map((t, i) => [t, i]).filter(([t]) => baby(t)), out = new Map();
  const rec = (j, used, rem) => {
    if (j === hs.length) { const k = sortK(used.map(i => floor[i])) + '|' + sortK(rem); if (!out.has(k)) out.set(k, { used: used.slice(), rem: rem.slice() }); return; }
    rec(j + 1, used, rem);
    const [t, i] = hs[j], o = RXP(plain(t)), tried = new Set();
    rem.forEach((q, qi) => { if (tried.has(q) || !rxMatch(q, o) || !rxValidate('cradle', [o]).ok) return; tried.add(q); const r2 = rem.slice(); r2.splice(qi, 1); rec(j + 1, used.concat(i), r2); });
  };
  rec(0, [], seats); return [...out.values()];
}
function won(s, lvl) {
  if (lvl.gateKind === 'line') return s.line.length === lvl.gate.length && s.line.every((t, i) => rxMatch(lvl.gate[i], RXP(t)));
  if (lvl.gateKind === 'cradle') return cradleChoices(s.floor, s.cradle).some(c => !c.rem.length);
  return seatable(s.floor, lvl.gate, lvl.gateKind);
}
function tuples(n, k, ordered) {
  const out = [];
  const rec = (start, cur, used) => { if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = ordered ? 0 : start; i < n; i++) if (!used.has(i)) { used.add(i); cur.push(i); rec(i + 1, cur, used); cur.pop(); used.delete(i); } };
  rec(0, [], new Set()); return out;
}
function moves(s, lvl) {
  const out = [], seen = new Set();
  const types = [...new Set(lvl.machines)];
  for (const m of types) {
    if (m === 'nest' && !s.nests) continue;
    const k = HOLES[m]; if (s.floor.length < k) continue;
    for (const c of tuples(s.floor.length, k, m.startsWith('pool'))) {
      const ins = c.map(i => s.floor[i]);
      if (m === 'nest' && ins.some(baby)) continue;                     // hatchlings are too young for a Nest
      const sig = m + ':' + (m.startsWith('pool') ? ins.join('+') : ins.slice().sort().join('+')); if (seen.has(sig)) continue; seen.add(sig);
      const r = rxReact(m, ins.map(t => RXP(plain(t)))); if (r.fail) continue;
      const rest = s.floor.filter((_, i) => !c.includes(i));
      let out1;
      if (r.transform) out1 = r.transform.map((x, i) => x ? RXF(x) + (baby(ins[i]) ? '~' : '') : null).filter(Boolean);
      else if (r.consume) out1 = (r.spawn || []).map(x => RXF(x));
      else out1 = ins.slice();                                          // the Nest: parents stay
      if (m === 'nest') {
        const kids = (r.spawn || []).map(x => RXF(x) + '~');
        // before the clutch hatches, seat any hatchlings you want in the Cradle; the rest grow up
        const choices = lvl.gateKind === 'cradle' ? cradleChoices(rest, s.cradle) : [{ used: [], rem: s.cradle }];
        for (const ch of choices) {
          const floor = rest.filter((_, i) => !ch.used.includes(i)).map(plain).concat(ins.map(plain), kids);
          out.push({ act: (ch.used.length ? `seat(${ch.used.map(i => rest[i]).join('+')}) ` : '') + `nest(${ins.join('+')})`, next: { floor, line: s.line, nests: s.nests - 1, cradle: ch.rem } });
        }
        continue;
      }
      out.push({ act: `${m}(${ins.join('+')})`, next: { floor: rest.concat(out1), line: s.line, nests: s.nests, cradle: s.cradle } });
    }
  }
  if (lvl.gateKind === 'line') {
    const tried = new Set();
    s.floor.forEach((t, i) => { if (tried.has(t)) return; tried.add(t);
      const objs = s.line.map(x => RXP(x)), o = RXP(plain(t)), res = qJoin(objs, o);
      let line = res.line.map(x => RXF(x)), floor = s.floor.filter((_, k) => k !== i);
      if (line.length === lvl.gate.length && !line.every((x, j) => rxMatch(lvl.gate[j], RXP(x)))) { floor = floor.concat(line); line = []; }
      out.push({ act: `join(${t})`, next: { floor, line, nests: s.nests, cradle: s.cradle } }); });
  }
  return out;
}
const startOf = l => ({ floor: l.orbs.slice(), line: [], nests: l.machines.filter(m => m === 'nest').length, cradle: l.gateKind === 'cradle' ? l.gate.slice() : [] });
function solve(lvl, maxDepth = 9) {
  const start = startOf(lvl); if (won(start, lvl)) return { par: 0, solutions: 1, line: [] };
  const ways = new Map([[key(start), 1]]), parent = new Map(); let fr = [start];
  for (let d = 1; d <= maxDepth && fr.length; d++) {
    const nx = new Map();
    for (const s of fr) for (const mv of moves(s, lvl)) { const k = key(mv.next), w = ways.get(key(s));
      if (!ways.has(k)) { ways.set(k, w); parent.set(k, [key(s), mv]); nx.set(k, mv.next); } else if (nx.has(k)) ways.set(k, ways.get(k) + w); }
    const wins = [...nx].filter(([, s]) => won(s, lvl));
    if (wins.length) { let c = wins[0][0]; const line = [];
      while (parent.has(c)) { const [p, mv] = parent.get(c); line.unshift(mv.act); c = p; }
      return { par: d, solutions: wins.reduce((t, [k]) => t + ways.get(k), 0), line }; }
    fr = [...nx.values()]; if (nx.size > 60000) break;
  }
  return { par: null, solutions: 0, line: null };
}
function canWin(s, lvl, budget, memo = new Map()) {
  if (won(s, lvl)) return true; if (!budget) return false; const k = key(s) + '#' + budget; if (memo.has(k)) return memo.get(k);
  let ok = false; for (const mv of moves(s, lvl)) if (canWin(mv.next, lvl, budget - 1, memo)) { ok = true; break; }
  memo.set(k, ok); return ok;
}
function difficulty(lvl, trials = 1500) {
  const sol = solve(lvl), start = startOf(lvl), first = moves(start, lvl), par = sol.par || 6;
  const traps = first.filter(mv => !canWin(mv.next, lvl, par + 1)).length;
  let w = 0;
  for (let t = 0; t < trials; t++) { let s = start;
    for (let i = 0; i < par + 3 && !won(s, lvl); i++) { const ms = moves(s, lvl); if (!ms.length) break; s = ms[Math.floor(Math.random() * ms.length)].next; }
    if (won(s, lvl)) w++; }
  return { ...sol, firstMoves: first.length, traps, randomWin: w / trials };
}
const WORLDS = { commons: 1, nursery: 2, reef: 3, queue: 4 };
module.exports = { solve, difficulty, moves, won, RXL, RXP, RXF, rxReact };

// ---- search: random setups per world, a gate taken from where a random line of play ends up, kept if that is the cheapest way ----
const pick = a => a[Math.floor(Math.random() * a.length)], chance = p => Math.random() < p;
const SAMPLE = {
  commons() { const n = 3 + Math.floor(Math.random() * 3), orbs = [];
    for (let i = 0; i < n; i++) orbs.push(RXF({ c: pick('ryb'), e: 1 + Math.floor(Math.random() * 3), m: chance(.45) ? 'g' : 'h' }));
    if (chance(.6)) orbs.push(RXF({ k: pick(['tw', 'sp', 'vo', 'wi']) }));
    return { orbs, machines: ['press'].concat(chance(.7) ? ['meet'] : [], chance(.35) ? ['camp'] : []), gateKind: 'bench' }; },
  nursery() { const n = 2 + Math.floor(Math.random() * 3), orbs = [], G = ['YY', 'YR', 'YB', 'RR', 'RB', 'BB'];
    for (let i = 0; i < n; i++) orbs.push(RXF({ a: pick(G), m: chance(.35) ? 'g' : 'h' }));
    if (chance(.3)) orbs.push(RXF({ k: 'tw' }));
    const nests = 1 + Math.floor(Math.random() * 3), machines = Array(nests).fill('nest').concat(chance(.6) ? ['meet'] : [], chance(.25) ? ['camp'] : [], orbs.some(t => t.includes('k=')) ? ['press'] : []);
    return { orbs, machines, gateKind: chance(.55) ? 'cradle' : 'bench' }; },
  reef() { const n = 3 + Math.floor(Math.random() * 3), orbs = [];
    for (let i = 0; i < n; i++) orbs.push(RXF({ s: pick('sjg'), e: 1 + Math.floor(Math.random() * 3), u: 'h' }));
    if (chance(.5)) orbs.push(RXF({ k: pick(['tw', 'vo', 'wi', 'sp']) })); if (chance(.2)) orbs.push(RXF({ s: 'p' }));
    return { orbs, machines: ['press', pick(['pool2', 'pool2', 'pool3'])], gateKind: 'calm' }; },
  queue() { const n = 3 + Math.floor(Math.random() * 2), orbs = [];
    for (let i = 0; i < n; i++) orbs.push(RXF({ c: pick('ryb'), m: chance(.35) ? 'g' : 'h', q: pick('zcpe') }));
    const machines = [pick(['meet', 'camp'])].concat(chance(.5) ? [pick(['coffee', 'pillow'])] : []);
    return { orbs, machines, gateKind: 'line' }; },
};
function specFor(kind, t) { const o = RXP(plain(t)), c = rxColorOf(o);
  if (kind === 'calm') return o.s === 'p' ? '*s=p' : chance(.5) && o.e ? RXF({ e: o.e, s: o.s }) : RXF({ s: o.s });
  if (kind === 'bench') return o.k ? 'any' : chance(.55) && o.e ? RXF({ c, e: o.e }) : c ? RXF({ c }) : 'any';
  return c ? RXF({ c }) : 'any'; }
const rxColorOf = o => E.rxColor(o);
function search(world, PAR, want = 10, secs = 60) {
  const found = new Map(), end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    const setup = SAMPLE[world](); setup.orbs.sort();
    // play PAR random moves (exploring as a bench so nothing is seated), then build a gate from the result
    const explore = { ...setup, gateKind: setup.gateKind === 'line' ? 'line' : 'bench', gate: setup.gateKind === 'line' ? setup.orbs.map(() => 'any') : ['none'] };
    let s = startOf({ ...explore }); s.cradle = []; let ok = true;
    for (let i = 0; i < PAR; i++) { const ms = moves(s, explore).filter(m => !m.act.startsWith('join')); if (!ms.length) { ok = false; break; } s = pick(ms).next; }
    if (!ok) continue;
    let gate;
    if (setup.gateKind === 'line') { gate = setup.orbs.map(t => rxColorOf(RXP(t))).sort(() => Math.random() - .5).map(c => RXF({ c })); }
    else { const pool = setup.gateKind === 'cradle' ? s.floor.filter(baby) : s.floor.filter(t => !t.includes('k=')); if (pool.length < 2) continue;
      const n = Math.min(pool.length, 2 + Math.floor(Math.random() * 3)), chosen = pool.slice().sort(() => Math.random() - .5).slice(0, n);
      gate = chosen.map(t => specFor(setup.gateKind, t)); }
    const lvl = { ...setup, gate }, k = sortK(lvl.orbs) + '|' + lvl.machines.join() + '|' + lvl.gateKind + '|' + gate.join(' ');
    if (found.has(k)) continue; found.set(k, null);
    const sol = solve(lvl, PAR); if (sol.par !== PAR) continue;
    const d = difficulty(lvl, 400);
    found.set(k, { ...lvl, ...d, score: (1 - d.randomWin) * 4 + (d.traps / Math.max(1, d.firstMoves)) * 3 + (d.solutions <= 2 ? 1.5 : d.solutions <= 6 ? .6 : 0) });
  }
  return [...found.values()].filter(Boolean).sort((a, b) => b.score - a.score).slice(0, want);
}
module.exports.search = search;

if (require.main === module) {
  const [cmd] = process.argv.slice(2), pad = (s, n) => String(s).padEnd(n);
  if (cmd === 'search') { const [, world, par, count = '10', secs = '60'] = process.argv.slice(2);
    for (const c of search(world, +par, +count, +secs)) console.log(JSON.stringify({ orbs: c.orbs, machines: c.machines, gateKind: c.gateKind, gate: c.gate }), `| optimal ${c.solutions} traps ${c.traps}/${c.firstMoves} random ${(c.randomWin * 100).toFixed(1)}% | ${c.line.join(' > ')}`); }
  if (cmd === 'report') for (const [w, i] of Object.entries(WORLDS)) {
    console.log(`\n== ${w} remix`);
    RXL[i].forEach((l, k) => { const d = difficulty(l);
      const flag = d.par === null ? ' UNSOLVABLE' : d.par !== l.par ? ` PAR MISMATCH (game says ${l.par})` : '';
      console.log(`${String(k + 1).padStart(2)} ${pad(l.name, 20)} par ${l.par} solver ${d.par}  optimal ${pad(d.solutions, 4)} traps ${d.traps}/${d.firstMoves}  random ${(d.randomWin * 100).toFixed(1).padStart(5)}%  ${(d.line || []).join(' > ')}${flag}`); });
  }
}
