"""Build beta/index.html from an index.html (normally the levels-pilot branch's).

    python tools/make-beta.py <source index.html> <output beta/index.html>

The beta is the same game served from /orbwork/beta/: assets resolve to the parent folder,
it has its own save keys (so testing never touches real progress) and every level is unlocked.
"""
import io, sys

src, out = sys.argv[1], sys.argv[2]
s = io.open(src, encoding='utf-8').read()

def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)

rep('<meta charset="utf-8">\n', '<meta charset="utf-8">\n<base href="../">\n<meta name="robots" content="noindex">\n')
rep("<title>Blobbiverse</title>", "<title>Blobbiverse (level beta)</title>")
rep("const KEY='orbwork-v2', OLD='orbwork-levels-v1';", "const KEY='orbwork-beta-levels', OLD='orbwork-beta-none';   // beta: separate save")
rep("const PREF_KEY='orbwork-prefs';", "const PREF_KEY='orbwork-beta-prefs';")
rep('<div class="splash" id="splash"><small>A game by</small><b>bernalj</b></div>',
    '<div class="splash" id="splash"><small>Level beta</small><b>bernalj</b></div>')
rep("const worldOpen = i => i===0 || Object.keys(S.prog[0].best).length>=UNLOCK_AT;", "const worldOpen = () => true;   // beta: everything unlocked for testing")
rep("const levelOpen = (wi,i) => i===0 || !!S.prog[wi].best[i-1];", "const levelOpen = () => true;")
io.open(out, 'w', encoding='utf-8', newline='').write(s)
print('beta written to', out)
