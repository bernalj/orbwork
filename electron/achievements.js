// Steam achievements for Blobbiverse, evaluated from the progress summary the game sends (see hostSync() in index.html).
// `id` is the API name to create on the Steamworks "Stats & Achievements" page; name/description are the suggested store text.

const WORLD_NAMES = { w1: 'Hatchery', w2: 'Commons', w3: 'Nursery', w4: 'Reef', wq: 'Queue', ws: 'Seesaw', wl: 'Lighthouse' };

const sum = (worlds, key) => worlds.reduce((n, w) => n + w[key], 0);
const world = (p, id) => p.worlds.find(w => w.id === id);

const ACHIEVEMENTS = [
  { id: 'FIRST_POP', name: 'First pop', description: 'Open your first Gate.',
    done: p => sum(p.worlds, 'mainCleared') + sum(p.worlds, 'remixCleared') > 0 },
  { id: 'FIRST_NOTE', name: 'Field notes', description: 'Write your first Notebook entry.',
    done: p => p.learned > 0 },
  ...Object.entries(WORLD_NAMES).map(([wid, name]) => ({
    id: `CLEAR_${name.toUpperCase()}`, name: `${name} done`, description: `Finish every main level of the ${name}.`,
    done: p => { const w = world(p, wid); return !!w && w.mainTotal > 0 && w.mainCleared === w.mainTotal; },
  })),
  { id: 'FIRST_REMIX', name: 'Mixed company', description: 'Finish a Remix level.',
    done: p => sum(p.worlds, 'remixCleared') > 0 },
  { id: 'ALL_REMIX', name: 'Remixed', description: 'Finish every Remix level.',
    done: p => sum(p.worlds, 'remixTotal') > 0 && sum(p.worlds, 'remixCleared') === sum(p.worlds, 'remixTotal') },
  { id: 'PAR_WORLD', name: 'Under par', description: 'Earn three stars on every main level of any world.',
    done: p => p.worlds.some(w => w.mainTotal > 0 && w.mainPerfect === w.mainTotal) },
  { id: 'ALL_LEVELS', name: 'Blobbiverse', description: 'Finish every level in the game.',
    done: p => p.worlds.every(w => w.mainCleared === w.mainTotal && w.remixCleared === w.remixTotal) },
  // Secret: set this one to "Hidden" on the Steamworks page so its description stays secret until unlocked.
  { id: 'NEWTONS_CRADLE', name: 'Newton’s cradle', description: 'Line up five or more blobs in the Reef so that everyone in the middle trembles and only the two at the ends keep still.', hidden: true,
    done: p => (p.feats || []).includes('cradle') },
  { id: 'ALL_STARS', name: 'Every star', description: 'Earn three stars on every level in the game.',
    done: p => p.worlds.every(w => w.mainPerfect === w.mainTotal && w.remixPerfect === w.remixTotal) },
];

// Spacewar (app 480) only has Valve's sample achievements, so map a few of ours onto them for end-to-end testing.
const SPACEWAR_TEST_MAP = { FIRST_POP: 'ACH_WIN_ONE_GAME', FIRST_NOTE: 'NEW_ACHIEVEMENT_0_4', CLEAR_HATCHERY: 'ACH_TRAVEL_FAR_ACCUM' };

function earned(progress) {
  if (!progress || !Array.isArray(progress.worlds)) return [];
  return ACHIEVEMENTS.filter(a => { try { return a.done(progress); } catch { return false; } }).map(a => a.id);
}

module.exports = { ACHIEVEMENTS, SPACEWAR_TEST_MAP, earned };
