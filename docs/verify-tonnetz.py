import itertools
from collections import Counter
def prime(pcs):
    pcs=sorted(set(pcs)); b=None
    for r in pcs:
        n=tuple(sorted((p-r)%12 for p in pcs))
        if b is None or n<b: b=n
    return b
MAJ,MIN=(0,4,7),(0,3,7)

# --- (a) icosahedron chirality: does mirroring the labelling turn minor into major?
pc={0:0,1:7,2:2,3:3,4:5,5:10,6:9,7:11,8:4,9:6,10:1,11:8}
phi=(1+5**0.5)/2
V=[]
for s1 in(1,-1):
    for s2 in(1,-1):
        V+=[(0,s1*1,s2*phi),(s1*1,s2*phi,0),(s1*phi,0,s2*1)]
V=[tuple(round(c,6) for c in v) for v in V]
def d(a,b): return sum((x-y)**2 for x,y in zip(a,b))**0.5
e=min(d(a,b) for a,b in itertools.combinations(V,2))
adj={i:set() for i in range(12)}
for i,j in itertools.combinations(range(12),2):
    if abs(d(V[i],V[j])-e)<1e-6: adj[i].add(j); adj[j].add(i)
faces=[t for t in itertools.combinations(range(12),3)
       if t[1] in adj[t[0]] and t[2] in adj[t[0]] and t[2] in adj[t[1]]]
orig=Counter(prime([pc[v] for v in f]) for f in faces)
mir =Counter(prime([(-pc[v])%12 for v in f]) for f in faces)
print("icosahedron, original labelling : maj %d  min %d"%(orig[MAJ],orig[MIN]))
print("icosahedron, mirrored labelling : maj %d  min %d"%(mir[MAJ],mir[MIN]))

# --- (b) the Tonnetz torus: vertices=12 pitch classes, axes = fifth(7) and major third(4)
# lattice point (a,b) -> pitch (7a + 4b) mod 12 ; wraps to a torus
pts={}
for a in range(12):
    for b in range(3):
        pts[(a,b)]=(7*a+4*b)%12
# triangular faces: (a,b),(a+1,b),(a,b+1)  and  (a+1,b),(a,b+1),(a+1,b+1)
F=[]
for a in range(12):
    for b in range(3):
        F.append(((a,b),((a+1)%12,b),(a,(b+1)%3)))
        F.append((((a+1)%12,b),(a,(b+1)%3),((a+1)%12,(b+1)%3)))
cells=set()
for f in F:
    cells.add(tuple(sorted(pts[p] for p in f)))
fc=Counter(prime([pts[p] for p in f]) for f in F)
print("\nTonnetz torus: %d lattice cells -> %d distinct chords"%(len(F),len(cells)))
print("  face census:", {('MAJOR' if k==MAJ else 'MINOR' if k==MIN else str(k)):v for k,v in fc.items()})
E=set()
for a in range(12):
    for b in range(3):
        for q in (((a+1)%12,b),(a,(b+1)%3),((a+1)%12,(b-1)%3)):
            E.add(frozenset((pts[(a,b)],pts[q])))
ec=Counter(min((x-y)%12,(y-x)%12) for ed in E for x,y in [tuple(ed)])
print("  distinct edges: %d  interval classes: %s"%(len(E),dict(sorted(ec.items()))))

# --- (c) torus knots: does a (p,q) orbit close, and how many strikes per cycle?
print("\n(p,q) torus-knot orbits  ->  polyrhythm:")
from math import gcd
for p,q in [(3,4),(3,2),(5,4),(7,8),(5,3),(4,3),(2,3),(5,2)]:
    print("   (%d,%d): winds %d x fifth-axis, %d x third-axis, closes after lcm=%d steps, gcd=%d %s"
          %(p,q,p,q,p*q//gcd(p,q)*1,gcd(p,q),"KNOT" if gcd(p,q)==1 else "link of %d loops"%gcd(p,q)))
