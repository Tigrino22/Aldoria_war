"""Génère les illustrations des bâtiments en 3 stades d'évolution (niveaux 1-6, 7-13, 14-20).

Chaque bâtiment est composé de pièces SVG réutilisables ; les stades ajoutent ou remplacent des pièces.
Usage : python3 tools/generate-buildings.py  (écrit dans client/src/assets/buildings/)
"""
import os

O = '#3b2a1a'
OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'src', 'assets', 'buildings')

def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" stroke-linejoin="round" stroke-linecap="round">{body}</svg>\n'

shadow = '<ellipse cx="48" cy="86" rx="40" ry="7" fill="#000" opacity=".18"/>'
def flag(x, y, color='#2f6fdc', h=12):
    return f'<path d="M{x} {y+h} V{y}" stroke="{O}" stroke-width="2"/><path d="M{x} {y} l11 3 -11 4 z" fill="{color}" stroke="{O}" stroke-width="1.5"/>'
def smoke(x, y):
    return f'<g fill="#d8d4cc" stroke="#9a948a" stroke-width="1.2" opacity=".9"><circle cx="{x}" cy="{y}" r="4"/><circle cx="{x+4}" cy="{y-7}" r="5"/><circle cx="{x+1}" cy="{y-15}" r="6"/></g>'
def window(x, y, w=8, h=8):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#f2d98a" stroke="{O}" stroke-width="2"/>'
def door(x, y, w=14, h=18, color='#7a4b25'):
    r = w / 2
    return f'<path d="M{x} {y+h} v-{h-r} a{r} {r} 0 0 1 {w} 0 v{h-r} z" fill="{color}" stroke="{O}" stroke-width="2"/>'
def tower(x, y, w, h, fill='#bdb3a0', roof=None):
    t = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{O}" stroke-width="2"/>'
    if roof:
        t += f'<path d="M{x-3} {y} L{x+w/2} {y-w*0.9} L{x+w+3} {y} Z" fill="{roof}" stroke="{O}" stroke-width="2"/>'
    else:
        c = w / 5
        t += f'<path d="M{x-2} {y} h{w+4} v-5 h-{c} v3 h-{c} v-3 h-{c} v3 h-{c} v-3 h-{c} v3 h-{c-4} v-3 z" fill="{fill}" stroke="{O}" stroke-width="2"/>'
    return t
def logs(x, y):
    return (f'<g stroke="{O}" stroke-width="2"><circle cx="{x}" cy="{y}" r="6" fill="#c48a52"/><circle cx="{x+12}" cy="{y}" r="6" fill="#c48a52"/>'
            f'<circle cx="{x+6}" cy="{y-10}" r="6" fill="#c48a52"/></g><g fill="#7a4b25"><circle cx="{x}" cy="{y}" r="2"/><circle cx="{x+12}" cy="{y}" r="2"/><circle cx="{x+6}" cy="{y-10}" r="2"/></g>')
def crate(x, y, s=14):
    return f'<g stroke="{O}" stroke-width="2"><rect x="{x}" y="{y}" width="{s}" height="{s}" fill="#c48a52"/><path d="M{x} {y} l{s} {s} M{x+s} {y} l-{s} {s}" stroke="#7a4b25"/></g>'
def sack(x, y):
    return f'<path d="M{x} {y} q-5 -12 5 -12 q8 0 4 12 z" fill="#e8d7a8" stroke="{O}" stroke-width="2"/>'
def bricks(x, y):
    return (f'<g stroke="{O}" stroke-width="2" fill="#c0563a"><rect x="{x}" y="{y}" width="12" height="6"/><rect x="{x+12}" y="{y}" width="12" height="6"/>'
            f'<rect x="{x+6}" y="{y-6}" width="12" height="6"/></g>')
def wheat_field(x0=4, w=88):
    return (f'<path d="M{x0} 86 L{x0+18} 62 H{x0+w} L{x0+w-12} 86 Z" fill="#e3c45a" stroke="{O}" stroke-width="2"/>'
            f'<path d="M{x0+10} 80 L{x0+24} 62 M{x0+26} 84 L{x0+38} 62 M{x0+44} 84 L{x0+54} 62 M{x0+60} 84 L{x0+70} 62" stroke="#b8952e" stroke-width="2"/>')
def tent(x, y, color='#e8dcc0', stripe='#2f6fdc'):
    return (f'<path d="M{x} {y} L{x+14} {y-22} L{x+28} {y} Z" fill="{color}" stroke="{O}" stroke-width="2"/>'
            f'<path d="M{x+14} {y-22} V{y} M{x+8} {y} L{x+14} {y-10} L{x+20} {y}" stroke="{stripe}" stroke-width="2" fill="none"/>')
def palisade(x0, x1, y, h=26):
    out = ''
    for x in range(x0, x1, 8):
        out += f'<path d="M{x} {y} v-{h} l4 -5 l4 5 v{h} z" fill="#a8703f" stroke="{O}" stroke-width="1.8"/>'
    return out + f'<path d="M{x0} {y-h/2} H{x1}" stroke="#7a4b25" stroke-width="3"/>'

B = {}

# Hôtel de ville : grange en bois -> maison de pierre à tour -> petit château
B['townhall'] = [
    shadow + f'''<rect x="20" y="48" width="56" height="36" fill="#a8703f" stroke="{O}" stroke-width="2"/>
<path d="M20 60 h56 M20 72 h56" stroke="#7a4b25" stroke-width="2"/>
<path d="M14 50 L48 24 L82 50 Z" fill="#d9b45a" stroke="{O}" stroke-width="2"/><path d="M26 44 L48 28 M40 46 L54 32 M66 44 L50 30" stroke="#b8952e" stroke-width="1.5"/>
{door(41, 66)}{window(26, 56)}{window(62, 56)}{flag(48, 12, h=13)}''',
    shadow + f'''<rect x="14" y="44" width="68" height="40" fill="#cfc6b4" stroke="{O}" stroke-width="2"/>
<path d="M10 46 L48 22 L86 46 Z" fill="#b84a3a" stroke="{O}" stroke-width="2"/>
{tower(38, 14, 20, 32)}<rect x="44" y="22" width="8" height="10" rx="4" fill="{O}"/>
{flag(48, 2, h=10)}{door(40, 66, 16)}{window(20, 54, 10, 10)}{window(66, 54, 10, 10)}''',
    shadow + f'''{tower(6, 30, 18, 54, roof='#2f6fdc')}{tower(72, 30, 18, 54, roof='#2f6fdc')}
<rect x="20" y="44" width="56" height="40" fill="#d6cdb9" stroke="{O}" stroke-width="2"/>
<path d="M20 44 h56 v-6 h-6 v3 h-6 v-3 h-6 v3 h-6 v-3 h-8 v3 h-6 v-3 h-6 v3 h-6 v-3 h-6 z" fill="#d6cdb9" stroke="{O}" stroke-width="2"/>
{tower(37, 22, 22, 22, roof='#b84a3a')}<rect x="44" y="28" width="8" height="10" rx="4" fill="{O}"/>
{flag(15, 6, '#f2c230', 10)}{flag(81, 6, '#f2c230', 10)}
{door(39, 64, 18, 20, '#5a3518')}<path d="M39 70 h18" stroke="#f2c230" stroke-width="2"/>{window(11, 46, 8, 8)}{window(77, 46, 8, 8)}{window(26, 54, 8, 8)}{window(62, 54, 8, 8)}''',
]

# Bûcheron : cabane -> cabane + réserve -> scierie avec roue à aubes
hut = f'''<rect x="18" y="46" width="40" height="36" fill="#a8703f" stroke="{O}" stroke-width="2"/>
<path d="M18 56 h40 M18 66 h40 M18 76 h40" stroke="#7a4b25" stroke-width="2"/>
<path d="M12 48 L38 26 L64 48 Z" fill="#7a4b25" stroke="{O}" stroke-width="2"/>
<rect x="30" y="62" width="12" height="20" fill="#5a3518" stroke="{O}" stroke-width="2"/>'''
axe = f'<path d="M76 32 l10 18" stroke="{O}" stroke-width="3"/><path d="M72 32 q6 -8 12 -2 l-6 6 z" fill="#9aa0a6" stroke="{O}" stroke-width="2"/>'
B['woodcutter'] = [
    shadow + hut + logs(70, 80) + axe,
    shadow + hut + logs(62, 80) + logs(76, 80) + f'<path d="M64 70 h30" stroke="{O}" stroke-width="2"/>' + axe.replace('76 32', '82 22').replace('72 32', '78 22'),
    shadow + f'''<rect x="14" y="40" width="52" height="44" fill="#a8703f" stroke="{O}" stroke-width="2"/>
<path d="M14 52 h52 M14 64 h52 M14 76 h52" stroke="#7a4b25" stroke-width="2"/>
<path d="M8 42 L40 18 L72 42 Z" fill="#b84a3a" stroke="{O}" stroke-width="2"/>{door(32, 64, 14, 20, '#5a3518')}{window(20, 46)}{window(52, 46)}
<circle cx="76" cy="64" r="16" fill="none" stroke="{O}" stroke-width="3"/><g stroke="#7a4b25" stroke-width="3"><path d="M76 48 V80 M60 64 H92 M65 53 L87 75 M87 53 L65 75"/></g><circle cx="76" cy="64" r="4" fill="#5a3518" stroke="{O}" stroke-width="2"/>
<path d="M62 84 q14 -6 32 0" fill="#5b9bd5" stroke="{O}" stroke-width="2"/>{logs(4, 82)}''',
]

# Argilière : fosse -> fosse + briques -> four à briques fumant
pit = f'''<ellipse cx="40" cy="72" rx="30" ry="13" fill="#8a5a3a" stroke="{O}" stroke-width="2"/><ellipse cx="40" cy="74" rx="20" ry="7" fill="#6b4128"/>
<path d="M16 64 q8 -16 20 -6 q8 -12 18 0 q8 -8 12 6" fill="#c8794a" stroke="{O}" stroke-width="2"/>'''
shovel = f'<path d="M22 40 l6 26" stroke="{O}" stroke-width="3"/><path d="M18 36 h14 l-3 8 h-8 z" fill="#9aa0a6" stroke="{O}" stroke-width="2"/>'
B['claypit'] = [
    shadow + pit + shovel,
    shadow + pit + shovel + bricks(64, 80) + bricks(64, 68).replace('y="62"', 'y="62"'),
    shadow + pit.replace('cx="40"', 'cx="34"') + f'''<path d="M58 84 v-22 a16 16 0 0 1 32 0 v22 z" fill="#b5654a" stroke="{O}" stroke-width="2"/>
<path d="M66 84 v-10 a8 8 0 0 1 16 0 v10 z" fill="#f29a3a" stroke="{O}" stroke-width="2"/><rect x="78" y="36" width="8" height="14" fill="#8e3226" stroke="{O}" stroke-width="2"/>
{smoke(82, 30)}{bricks(10, 86)}''',
]

# Mine de fer : entrée simple -> entrée étayée et wagonnet -> mine avec rails et forge
hill = f'''<path d="M6 84 L30 30 L46 42 L60 20 L90 84 Z" fill="#8d877d" stroke="{O}" stroke-width="2"/>
<path d="M30 30 l6 14 M60 20 l-4 16 l8 10" fill="none" stroke="#6d675e" stroke-width="2"/>'''
entrance = f'''<path d="M34 84 v-20 a14 14 0 0 1 28 0 v20 z" fill="#2a2018" stroke="{O}" stroke-width="2"/>'''
frame = f'<path d="M32 84 v-22 h32 v22" fill="none" stroke="#7a4b25" stroke-width="4"/><path d="M30 62 h36" stroke="#7a4b25" stroke-width="5"/>'
cart = f'''<g stroke="{O}" stroke-width="2"><path d="M66 70 h22 l-3 10 h-16 z" fill="#7a4b25"/><circle cx="71" cy="82" r="3" fill="#555"/><circle cx="83" cy="82" r="3" fill="#555"/></g>
<path d="M70 70 l4 -6 l5 3 l4 -4 l3 7 z" fill="#4b5563" stroke="{O}" stroke-width="1.5"/>'''
B['ironmine'] = [
    shadow + hill + entrance,
    shadow + hill + entrance + frame + cart,
    shadow + hill + entrance + frame + cart.replace('66 70', '62 70') + f'''<path d="M30 88 H94" stroke="#5a3518" stroke-width="2"/><path d="M34 86 v4 M44 86 v4 M54 86 v4 M64 86 v4 M74 86 v4 M84 86 v4" stroke="#5a3518" stroke-width="2"/>
<rect x="4" y="56" width="22" height="28" fill="#9aa0a6" stroke="{O}" stroke-width="2"/><rect x="16" y="40" width="7" height="16" fill="#6b7280" stroke="{O}" stroke-width="2"/>
{door(8, 70, 10, 14, '#f29a3a')}{smoke(20, 34)}''',
]

# Ferme : champ + chaumière -> grange -> grange + moulin
barn = f'''<rect x="38" y="30" width="38" height="30" fill="#b84a3a" stroke="{O}" stroke-width="2"/>
<path d="M32 32 L57 12 L82 32 Z" fill="#d9b45a" stroke="{O}" stroke-width="2"/>
<path d="M50 60 v-16 h14 v16" fill="#7a3328" stroke="{O}" stroke-width="2"/><path d="M50 44 l14 16 M64 44 l-14 16" stroke="#f2e2c0" stroke-width="2"/>'''
B['farm'] = [
    shadow + wheat_field() + f'''<rect x="46" y="40" width="26" height="20" fill="#e8dcc0" stroke="{O}" stroke-width="2"/>
<path d="M42 42 L59 26 L76 42 Z" fill="#d9b45a" stroke="{O}" stroke-width="2"/>{door(54, 46, 9, 14)}''',
    shadow + wheat_field() + barn + f'<g fill="#d9b45a" stroke="{O}" stroke-width="1.5"><path d="M14 58 l4 -14 l4 14 z"/><path d="M22 60 l4 -12 l4 12 z"/></g>',
    shadow + wheat_field() + barn.replace('38', '44').replace('M32 32 L57 12 L82 32', 'M38 32 L63 12 L88 32').replace('M50 60 v-16 h14 v16', 'M56 60 v-16 h14 v16').replace('M50 44 l14 16 M64 44 l-14 16', 'M56 44 l14 16 M70 44 l-14 16')
    + '<g transform="translate(4 0)">' + f'''<path d="M14 62 L18 26 H28 L32 62 Z" fill="#e8dcc0" stroke="{O}" stroke-width="2"/><path d="M14 28 L23 16 L32 28 Z" fill="#8e3226" stroke="{O}" stroke-width="2"/>
<g stroke="{O}" stroke-width="2" fill="#f2e2c0"><path d="M23 30 L23 6 L28 8 L28 28 Z"/><path d="M23 30 L47 30 L45 35 L25 35 Z"/><path d="M23 30 L23 54 L18 52 L18 32 Z"/><path d="M23 30 L-1 30 L1 25 L21 25 Z"/></g><circle cx="23" cy="30" r="3" fill="{O}"/></g>''',
]

# Entrepôt : remise -> entrepôt en bois -> grand entrepôt de pierre
B['warehouse'] = [
    shadow + f'''<rect x="24" y="52" width="44" height="32" fill="#a8703f" stroke="{O}" stroke-width="2"/><path d="M24 64 h44 M24 74 h44" stroke="#7a4b25" stroke-width="2"/>
<path d="M18 54 L46 34 L74 54 Z" fill="#7a4b25" stroke="{O}" stroke-width="2"/>{door(38, 66, 14, 18, '#5a3518')}{sack(76, 84)}{sack(14, 84)}''',
    shadow + f'''<rect x="10" y="40" width="64" height="44" fill="#a8703f" stroke="{O}" stroke-width="2"/><path d="M10 52 h64 M10 64 h64 M10 76 h64" stroke="#7a4b25" stroke-width="2"/>
<path d="M4 42 L42 18 L80 42 Z" fill="#8e3226" stroke="{O}" stroke-width="2"/><path d="M30 84 v-24 h24 v24" fill="#5a3518" stroke="{O}" stroke-width="2"/>
<path d="M30 60 l24 24 M54 60 l-24 24" stroke="#a8703f" stroke-width="2"/>{crate(72, 68)}{sack(78, 68)}''',
    shadow + f'''<rect x="6" y="36" width="76" height="48" fill="#c9c1ad" stroke="{O}" stroke-width="2"/><path d="M6 50 h76 M6 66 h76 M22 36 v14 M44 50 v16 M66 36 v14 M30 66 v18 M58 66 v18" stroke="#9e9686" stroke-width="2"/>
<path d="M0 38 L44 12 L88 38 Z" fill="#b84a3a" stroke="{O}" stroke-width="2"/><path d="M32 84 v-22 h24 v22" fill="#5a3518" stroke="{O}" stroke-width="2"/>{window(14, 54)}{window(66, 54)}
{flag(44, 0, '#2f6fdc', 12)}{crate(74, 70)}{crate(80, 56, 12)}{sack(4, 84)}''',
]

# Caserne : camp de tentes -> bâtiment fortifié -> caserne avec tour et étendards
shields = f'''<path d="M22 46 v18 l6 4 l6 -4 v-18 z" fill="#2f6fdc" stroke="{O}" stroke-width="2"/><path d="M62 46 v18 l6 4 l6 -4 v-18 z" fill="#2f6fdc" stroke="{O}" stroke-width="2"/>
<path d="M28 50 v12 M68 50 v12" stroke="#f2d98a" stroke-width="2"/>'''
spears = f'<path d="M32 20 L64 44 M64 20 L32 44" stroke="{O}" stroke-width="3"/><path d="M28 16 l6 1 -1 6 z M68 16 l-6 1 1 6 z" fill="#9aa0a6" stroke="{O}" stroke-width="2"/>'
B['barracks'] = [
    shadow + palisade(6, 90, 86, 18) + tent(10, 74) + tent(50, 70, '#e8dcc0', '#b84a3a') + flag(46, 34, '#2f6fdc', 16)
    + f'<path d="M80 74 L90 46" stroke="#7a4b25" stroke-width="2"/><path d="M88 42 l4 2 -2 5 z" fill="#9aa0a6" stroke="{O}" stroke-width="1.5"/>',
    shadow + f'''<rect x="12" y="38" width="72" height="46" fill="#b0a898" stroke="{O}" stroke-width="2"/>
<path d="M12 38 h72 v-8 h-8 v4 h-8 v-4 h-8 v4 h-8 v-4 h-8 v4 h-8 v-4 h-8 v4 h-8 v-4 h-8 z" fill="#b0a898" stroke="{O}" stroke-width="2"/>
{door(38, 66, 20, 18, '#5a3518')}{shields}{spears}''',
    shadow + tower(70, 22, 22, 62) + f'''<rect x="4" y="38" width="70" height="46" fill="#b0a898" stroke="{O}" stroke-width="2"/>
<path d="M4 38 h70 v-8 h-7 v4 h-7 v-4 h-7 v4 h-7 v-4 h-7 v4 h-7 v-4 h-7 v4 h-7 v-4 h-7 z" fill="#b0a898" stroke="{O}" stroke-width="2"/>
{door(30, 66, 20, 18, '#5a3518')}{shields.replace('22 46', '12 46').replace('62 46', '54 46').replace('M28 50', 'M18 50').replace('M68 50', 'M60 50')}
<rect x="77" y="34" width="8" height="10" rx="4" fill="{O}"/>{flag(81, 6, '#f2c230', 12)}{flag(10, 18, '#2f6fdc', 12)}{flag(66, 18, '#2f6fdc', 12)}
{spears.replace('32 20', '24 22').replace('64 44', '56 44').replace('64 20', '56 22').replace('32 44', '24 44').replace('28 16', '20 18').replace('68 16', '60 18')}''',
]

# Muraille : palissade -> mur de pierre -> rempart à tours
stone_wall = f'''<path d="M6 84 V44 h10 v-8 h10 v8 h10 v-8 h10 v8 h10 v-8 h10 v8 h10 v-8 h10 v8 h4 V84 Z" fill="#a7a29a" stroke="{O}" stroke-width="2"/>
<path d="M6 56 h84 M6 70 h84 M20 44 v12 M42 56 v14 M64 44 v12 M30 70 v14 M74 70 v14 M54 70 v14" stroke="#7d786f" stroke-width="2"/>'''
B['wall'] = [
    shadow + palisade(6, 90, 84, 34) + door(40, 64, 16, 20, '#5a3518'),
    shadow + stone_wall + door(40, 66, 16, 18, '#5a3518'),
    shadow + stone_wall.replace('V44', 'V50').replace('#a7a29a', '#b3ada3') + tower(2, 26, 22, 58) + tower(72, 26, 22, 58)
    + door(38, 62, 20, 22, '#5a3518') + f'<path d="M38 68 h20 M38 74 h20 M38 80 h20" stroke="{O}" stroke-width="1.5"/>'
    + flag(13, 6, '#2f6fdc', 15) + flag(83, 6, '#2f6fdc', 15) + window(9, 40, 8, 8) + window(79, 40, 8, 8),
]

plot = f'''<ellipse cx="48" cy="72" rx="36" ry="14" fill="#b08a5a" stroke="{O}" stroke-width="2" stroke-dasharray="5 5"/>
<g stroke="{O}" stroke-width="2" fill="#a8703f"><path d="M20 70 v-14 l3 -3 l3 3 v14 z"/><path d="M70 70 v-14 l3 -3 l3 3 v14 z"/></g>
<path d="M23 60 h50" stroke="#e3c45a" stroke-width="2" stroke-dasharray="4 3"/>'''

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.svg'):
        os.remove(os.path.join(OUT, f))
for key, stages in B.items():
    for i, body in enumerate(stages, start=1):
        with open(os.path.join(OUT, f'{key}-{i}.svg'), 'w') as fh:
            fh.write(svg(body))
with open(os.path.join(OUT, 'plot.svg'), 'w') as fh:
    fh.write(svg(plot))
print('Illustrations générées dans', os.path.normpath(OUT))
