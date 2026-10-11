#!/usr/bin/env python3
"""Moojis: Mooner emojis. Builds one SVG per face into site/assets/mooji/ from the logo's own paths.

    python3 site/tools/make-moojis.py

The logo (assets/mooner.svg) is a potrace trace: path 0 is the black square with the sticker outline cut out,
path 1 the black ring, 2/3/6/7 the craters, 4/5 the eyes. Every mooji keeps the ring and craters exactly and
swaps or decorates the rest. Which emoji maps to which file lives in site/mooji.js.
"""
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "assets", "mooji")

P = re.findall(r'<path d="([^"]+)"', open(os.path.join(SITE, "assets", "mooner.svg")).read())
assert len(P) == 8, "the logo changed; re-check the path roles above"

# Every command after each path's first `m` is relative, so a subpath can be lifted out by making its start
# absolute. Sticker outline: path 0's second subpath starts at (0, 6270) + (5711, 4450).
SILHOUETTE = "M5711 10720" + P[0][P[0].index("m5711 4450") + len("m5711 4450"):]
# The body inside the ring: path 1's second subpath, (5600, 10479) + (316, -637).
BODY = "M5916 9842" + P[1][P[1].index("m316-637") + len("m316-637"):]
RING, CRATERS, EYE_L, EYE_R = P[1], [P[2], P[3], P[6], P[7]], P[4], P[5]
T = 'transform="matrix(.1 0 0 -.1 0 1254)"'  # the trace's coordinates -> the 1254 x 1254 viewBox

# Landmarks in viewBox units, measured off the render.
L, R = (576, 642), (842, 680)            # eye centres
LS, RS = (550, 632), (821, 676)          # the stars inside them
MOUTH = (728, 885)

INK, TEAR, PINK, GREEN, RED, GOLD, ORANGE = "#000", "#7fd3ff", "#ff7aa2", "#3ee07f", "#ff3b30", "#f1e64a", "#ff8a1f"


def stroke(d, w=38, color=INK, extra=""):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'


def outlined(d, w, color, edge=22):
    """A coloured stroke with a black edge, so it reads on the black site and on white."""
    return stroke(d, w + edge) + stroke(d, w, color)


def shape(d, fill, edge=20, extra=""):
    return f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{edge}" stroke-linejoin="round" {extra}/>'


def trace(d, fill=INK):
    return f'<path {T} d="{d}" fill="{fill}"/>'


def face(eyes="both", body="#fff", craters=True, defs=""):
    parts = [trace(SILHOUETTE, "#fff")]
    if body != "#fff":
        parts.append(trace(BODY, body))
    parts.append(trace(RING))
    if craters:
        parts += [trace(c) for c in CRATERS]
    if eyes in ("both", "left"):
        parts.append(trace(EYE_L))
    if eyes in ("both", "right"):
        parts.append(trace(EYE_R))
    return defs, "".join(parts)


def svg(name, title, base, front="", behind="", wrap=None):
    defs, body = base
    inner = behind + body + front
    if wrap:
        inner = f'<g transform="{wrap}">{inner}</g>'
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="130 100 1000 1000"><title>{title}</title>'
           + (f"<defs>{defs}</defs>" if defs else "") + inner + "</svg>\n")
    with open(os.path.join(OUT, name + ".svg"), "w") as f:
        f.write(doc)
    return name


# ---- parts ------------------------------------------------------------------------------------------------

def smile():
    return stroke("M655 862 Q725 928 802 856", 40)


def grin(tongue=PINK, big=False):
    d = ("M622 836 Q728 862 838 830 Q828 940 730 943 Q632 940 622 836Z" if big
         else "M645 848 Q728 868 812 846 Q806 936 728 939 Q650 936 645 848Z")
    return (f'<clipPath id="m"><path d="{d}"/></clipPath>' + f'<path d="{d}" fill="{INK}"/>'
            + f'<ellipse cx="730" cy="{935 if big else 928}" rx="{62 if big else 48}" ry="30" fill="{tongue}" clip-path="url(#m)"/>'
            + f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="18" stroke-linejoin="round"/>')


def frown():
    return stroke("M662 915 Q728 850 796 908", 40)


def tongue_out(x=742, y=885, color=PINK):
    d = f"M{x-40} {y-8} Q{x-44} {y+82} {x+2} {y+86} Q{x+46} {y+84} {x+40} {y-10}Z"
    return shape(d, color, 18) + stroke(f"M{x} {y+8} V{y+50}", 12)


def drop(x, y, s, fill=TEAR, tilt=0):
    """A teardrop, point up, centred on (x, y)."""
    d = (f"M{x} {y-s} C{x+0.62*s:.0f} {y-0.15*s:.0f} {x+0.62*s:.0f} {y+0.62*s:.0f} {x} {y+0.62*s:.0f} "
         f"C{x-0.62*s:.0f} {y+0.62*s:.0f} {x-0.62*s:.0f} {y-0.15*s:.0f} {x} {y-s}Z")
    shine = f'<ellipse cx="{x-0.2*s:.0f}" cy="{y+0.12*s:.0f}" rx="{0.1*s:.0f}" ry="{0.18*s:.0f}" fill="#fff"/>'
    return f'<g transform="rotate({tilt} {x} {y})">' + shape(d, fill, 16) + shine + "</g>"


def heart(x, y, s, fill="#ff4f7b", tilt=0):
    d = (f"M{x} {y+0.42*s:.0f} C{x-0.12*s:.0f} {y+0.3*s:.0f} {x-0.52*s:.0f} {y+0.02*s:.0f} {x-0.52*s:.0f} {y-0.2*s:.0f} "
         f"C{x-0.52*s:.0f} {y-0.46*s:.0f} {x-0.2*s:.0f} {y-0.54*s:.0f} {x} {y-0.3*s:.0f} "
         f"C{x+0.2*s:.0f} {y-0.54*s:.0f} {x+0.52*s:.0f} {y-0.46*s:.0f} {x+0.52*s:.0f} {y-0.2*s:.0f} "
         f"C{x+0.52*s:.0f} {y+0.02*s:.0f} {x+0.12*s:.0f} {y+0.3*s:.0f} {x} {y+0.42*s:.0f}Z")
    shine = f'<ellipse cx="{x-0.26*s:.0f}" cy="{y-0.22*s:.0f}" rx="{0.08*s:.0f}" ry="{0.12*s:.0f}" fill="#fff" transform="rotate(30 {x-0.26*s:.0f} {y-0.22*s:.0f})"/>'
    return f'<g transform="rotate({tilt} {x} {y})">' + shape(d, fill, 20) + shine + "</g>"


def sparkle(x, y, w, h=None, fill="#fff", edge=14):
    h = h or w
    d = (f"M{x} {y-h/2:.0f} Q{x} {y} {x+w/2:.0f} {y} Q{x} {y} {x} {y+h/2:.0f} "
         f"Q{x} {y} {x-w/2:.0f} {y} Q{x} {y} {x} {y-h/2:.0f}Z")
    return shape(d, fill, edge) if edge else f'<path d="{d}" fill="{fill}"/>'


def gem(x, y, w, fill="#7fe8ff"):
    k = lambda px, py: f"{x+px*w:.0f} {y+py*w:.0f}"
    body = f"M{k(-.5,-.15)} L{k(-.25,-.45)} L{k(.25,-.45)} L{k(.5,-.15)} L{k(0,.55)}Z"
    crown = f"M{k(-.25,-.45)} L{k(.25,-.45)} L{k(.5,-.15)} L{k(-.5,-.15)}Z"
    facets = f"M{k(-.5,-.15)} L{k(.5,-.15)} M{k(-.12,-.15)} L{k(0,.55)} L{k(.12,-.15)} M{k(-.25,-.45)} L{k(-.12,-.15)} M{k(.25,-.45)} L{k(.12,-.15)}"
    return (shape(body, fill, 22) + f'<path d="{crown}" fill="#d4faff"/>' + stroke(facets, 12)
            + shape(body, "none", 22) + sparkle(x - 0.22 * w, y - 0.28 * w, 0.18 * w, edge=0))


def eye_ovals():
    return (f'<ellipse cx="{L[0]}" cy="{L[1]}" rx="116" ry="148" transform="rotate(9 {L[0]} {L[1]})" fill="{INK}"/>'
            f'<ellipse cx="{R[0]}" cy="{R[1]}" rx="98" ry="134" transform="rotate(9 {R[0]} {R[1]})" fill="{INK}"/>')


def happy_eyes(w=44):
    return stroke("M488 694 Q576 560 664 694", w) + stroke("M770 720 Q842 604 914 720", w)


def closed_eyes(w=40):  # sleeping, peaceful: arcs that droop
    return stroke("M494 646 Q576 712 658 646", w) + stroke("M776 682 Q842 744 908 682", w)


def lids(y_left, y_right, slant=0):
    """Heavy lids: the eyes are clipped below a line and the line is drawn in."""
    xl0, xl1, xr0, xr1 = 440, 712, 730, 960
    clip = (f'<clipPath id="lid"><path d="M0 {y_left-slant} L{xl1+8} {y_left+slant} L{xr0-8} {y_right-slant} L1254 {y_right+slant} V1254 H0Z"/></clipPath>')
    line = stroke(f"M{xl0} {y_left-slant} L{xl1} {y_left+slant}", 34) + stroke(f"M{xr0} {y_right-slant} L{xr1} {y_right+slant}", 34)
    return clip, line


def pupils(dx=0, dy=0, r=(34, 30), ring=True):
    out = ""
    for (x, y), rr, rx, ry in ((L, r[0], 92, 112), (R, r[1], 78, 100)):
        if ring:
            out += f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#fff" stroke="{INK}" stroke-width="30" transform="rotate(9 {x} {y})"/>'
        out += f'<circle cx="{x+dx}" cy="{y+dy}" r="{rr}" fill="{INK}"/>'
    return out


def flame(cx, base, w, h, fill):
    x0, x1, top = cx - w / 2, cx + w / 2, base - h
    return shape(f"M{x0:.0f} {base} Q{x0-0.1*w:.0f} {base-0.5*h:.0f} {cx-0.22*w:.0f} {base-0.62*h:.0f} "
                 f"Q{cx-0.18*w:.0f} {base-0.4*h:.0f} {cx-0.05*w:.0f} {base-0.42*h:.0f} Q{cx-0.12*w:.0f} {top+0.25*h:.0f} {cx+0.08*w:.0f} {top} "
                 f"Q{cx+0.12*w:.0f} {base-0.62*h:.0f} {cx+0.26*w:.0f} {base-0.6*h:.0f} Q{cx+0.28*w:.0f} {base-0.78*h:.0f} {cx+0.36*w:.0f} {base-0.82*h:.0f} "
                 f"Q{x1+0.12*w:.0f} {base-0.45*h:.0f} {x1:.0f} {base}Z", fill, 20)


def burst(cx, cy, r0, r1, n, fill, rot=0):
    pts = []
    for i in range(n * 2):
        a = math.pi * i / n + rot
        r = r1 if i % 2 == 0 else r0
        pts.append(f"{cx + r*math.sin(a):.0f} {cy - r*math.cos(a):.0f}")
    return shape("M" + " L".join(pts) + "Z", fill, 20)


def zed(x, y, s):
    return outlined(f"M{x-s/2:.0f} {y-s/2:.0f} H{x+s/2:.0f} L{x-s/2:.0f} {y+s/2:.0f} H{x+s/2:.0f}", 0.22 * s, TEAR, 20)


def beam(x0, y0, x1, y1, w):
    a = math.atan2(y1 - y0, x1 - x0) + math.pi / 2
    ox, oy = math.cos(a) * w / 2, math.sin(a) * w / 2
    poly = lambda k: f"M{x0} {y0} L{x1+ox*k:.0f} {y1+oy*k:.0f} L{x1-ox*k:.0f} {y1-oy*k:.0f}Z"
    return (f'<path d="{poly(1.9)}" fill="{RED}" opacity=".35"/>' + shape(poly(1), RED, 14)
            + f'<path d="{poly(0.35)}" fill="#fff"/>' + f'<circle cx="{x0}" cy="{y0}" r="46" fill="{RED}"/><circle cx="{x0}" cy="{y0}" r="22" fill="#fff"/>')


# ---- the set ----------------------------------------------------------------------------------------------
os.makedirs(OUT, exist_ok=True)
made = []

made.append(svg("smile", "gm", face(), smile()))
made.append(svg("grin", "wagmi", face(), grin()))
made.append(svg("lol", "lmao", face(eyes=None), happy_eyes() + grin(big=True)
                + drop(452, 612, 70, tilt=-60) + drop(978, 640, 64, tilt=60) + drop(420, 740, 44, tilt=-80) + drop(1004, 770, 40, tilt=80),
                wrap="rotate(-8 627 590)"))
made.append(svg("sob", "sold the bottom", face(eyes=None),
                stroke("M494 680 Q576 612 658 680", 42) + stroke("M776 714 Q842 652 908 714", 42)
                + shape("M536 700 Q520 860 548 1060 L612 1060 Q596 860 612 700Z", TEAR, 18)
                + shape("M806 732 Q794 870 814 1060 L874 1060 Q862 870 876 732Z", TEAR, 18)
                + shape("M660 862 Q690 842 728 862 Q766 842 796 862 Q800 925 728 928 Q656 925 660 862Z", INK, 16)))
made.append(svg("tear", "it's fine", face(), smile() + drop(918, 860, 52)))
made.append(svg("sad", "down bad", face(), frown() + drop(918, 860, 52)))
made.append(svg("sweat", "close one", face(), grin() + drop(1000, 400, 88, tilt=18)))

# deal-with-it pixel shades
U, X0, Y0 = 34, 430, 575
rows = [range(-3, 16), range(1, 15), list(range(1, 7)) + list(range(9, 15)), list(range(2, 6)) + list(range(10, 14))]
px = "".join(f'<rect x="{X0+c*U}" y="{Y0+r*U}" width="{U+1}" height="{U+1}"/>' for r, cols in enumerate(rows) for c in cols)
shine = "".join(f'<rect x="{X0+c*U}" y="{Y0+r*U}" width="{U}" height="{U}" fill="#fff"/>' for r, c in ((1, 2), (2, 3), (1, 10), (2, 11)))
made.append(svg("shades", "deal with it", face(eyes=None),
                f'<g transform="rotate(7 700 640)" fill="{INK}">{px}{shine}</g>' + stroke("M672 872 Q742 900 806 850", 38)))

def dollar(x, y, h):
    s = (f"M{x+0.3*h:.0f} {y-0.28*h:.0f} C{x+0.18*h:.0f} {y-0.46*h:.0f} {x-0.42*h:.0f} {y-0.44*h:.0f} {x-0.34*h:.0f} {y-0.14*h:.0f} "
         f"C{x-0.26*h:.0f} {y+0.06*h:.0f} {x+0.36*h:.0f} {y-0.02*h:.0f} {x+0.34*h:.0f} {y+0.22*h:.0f} "
         f"C{x+0.3*h:.0f} {y+0.48*h:.0f} {x-0.26*h:.0f} {y+0.46*h:.0f} {x-0.36*h:.0f} {y+0.26*h:.0f} M{x} {y-0.56*h:.0f} V{y+0.56*h:.0f}")
    return stroke(s, 0.14 * h, GREEN)

made.append(svg("money", "wen lambo", face(eyes=None), eye_ovals() + dollar(L[0], L[1], 190) + dollar(R[0], R[1], 165)
                + stroke("M652 858 Q728 910 806 852", 38) + tongue_out(740, 882, GREEN)))
made.append(svg("hearts", "in love with the chart", face(eyes=None),
                heart(L[0], L[1] - 4, 250, tilt=-10) + heart(R[0], R[1], 214, tilt=10) + grin()))
made.append(svg("starstruck", "100x", face(),
                sparkle(LS[0], LS[1], 124, 176, GOLD, 0) + sparkle(RS[0], RS[1], 100, 152, GOLD, 0) + grin()
                + sparkle(330, 330, 90, fill=GOLD) + sparkle(1010, 330, 70, fill=GOLD) + sparkle(1030, 860, 80, fill=GOLD) + sparkle(250, 820, 60, fill=GOLD)))
made.append(svg("diamond", "diamond hands", face(eyes=None), gem(L[0], L[1] - 10, 230) + gem(R[0], R[1] - 6, 196) + stroke("M672 872 Q742 900 806 850", 38)))
made.append(svg("wink", "ser", face(eyes="left"), stroke("M772 704 Q842 640 912 706", 44) + stroke("M660 866 Q740 920 806 846", 38)))
made.append(svg("tongue", "nfa", face(), stroke("M652 862 Q728 902 806 858", 36) + tongue_out(742, 880)))
made.append(svg("zany", "full port", face(eyes="left"), stroke("M772 704 Q842 640 912 706", 44)
                + stroke("M652 862 Q728 902 806 858", 36) + tongue_out(760, 878), wrap="rotate(10 627 590)"))

def lidded(name, title, y_l, y_r, slant, mouth, eyes_extra=""):
    clip, line = lids(y_l, y_r, slant)
    parts = [trace(SILHOUETTE, "#fff"), trace(RING)] + [trace(c) for c in CRATERS]
    parts.append(f'<g clip-path="url(#lid)">{trace(EYE_L)}{trace(EYE_R)}{eyes_extra}</g>')
    return svg(name, title, (clip, "".join(parts)), line + mouth)


made.append(lidded("smirk", "i told you", 612, 650, 12, stroke("M684 890 Q758 896 812 842", 38)))
made.append(lidded("meh", "bearish", 640, 678, 0, stroke("M676 884 H792", 38)))
made.append(svg("scream", "who sold", face(eyes=None, body="url(#pale)",
                                          defs='<linearGradient id="pale" x1="0" y1="1" x2="0" y2="0"><stop offset=".12" stop-color="#6fb8ff"/><stop offset=".6" stop-color="#fff"/></linearGradient>'
                                          '<clipPath id="gape"><ellipse cx="724" cy="858" rx="60" ry="80"/></clipPath>'),
                pupils(r=(30, 26)) + '<ellipse cx="724" cy="858" rx="60" ry="80" fill="#000"/>'
                + f'<ellipse cx="724" cy="938" rx="46" ry="34" fill="{PINK}" clip-path="url(#gape)"/>'
                # shock lines popping off the head
                + outlined("M300 300 L230 230 M266 400 L170 380 M380 230 L350 140", 20, "#fff")
                + outlined("M960 300 L1040 230 M1000 410 L1100 392 M880 220 L912 130", 20, "#fff")))
made.append(svg("mad", "who sold", face(body="#ff6a55"),
                stroke("M470 470 L664 548", 52) + stroke("M760 566 L936 500", 52) + stroke("M660 910 Q728 852 798 904", 40)
                + outlined("M1000 470 q30 -40 70 -20 q40 -30 60 10", 26, "#fff") + outlined("M240 520 q-10 -46 34 -60 q10 -46 56 -30", 26, "#fff")))
made.append(svg("evil", "laser eyes", face(body="#b48cff"),
                beam(LS[0], LS[1], 130, 720, 70) + beam(RS[0], RS[1], 1130, 780, 64)
                + shape("M640 846 L814 846 Q796 934 728 936 Q660 934 640 846Z", INK, 16)
                + '<path d="M664 850 L680 884 L696 850Z M760 850 L776 884 L792 850Z" fill="#fff"/>',
                behind=shape("M430 380 Q380 260 340 150 Q450 220 510 330Z", "#b48cff", 20) + shape("M830 330 Q900 230 990 170 Q970 290 910 390Z", "#b48cff", 20)))
made.append(svg("dead", "rekt", face(eyes=None),
                stroke("M505 570 L647 714 M647 570 L505 714", 46) + stroke("M782 616 L902 744 M902 616 L782 744", 46)
                + stroke("M660 872 Q728 896 806 866", 36) + tongue_out(772, 880)))
made.append(svg("clown", "bought the top", face(),
                stroke("M612 842 Q728 990 846 842", 58, RED) + stroke("M636 856 Q728 952 822 856", 18)
                + f'<circle cx="716" cy="792" r="50" fill="{RED}" stroke="{INK}" stroke-width="18"/><circle cx="700" cy="776" r="13" fill="#fff"/>',
                behind="".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}" stroke="{INK}" stroke-width="18"/>' for x, y, r, c in (
                    (300, 360, 74, "#ff4f7b"), (250, 470, 62, GOLD), (300, 560, 58, GREEN),
                    (990, 390, 74, "#6ec6ff"), (1050, 500, 62, "#ff4f7b"), (1010, 600, 58, GOLD)))))
made.append(svg("mindblown", "just read the whitepaper", face(eyes=None),
                pupils(r=(26, 22)) + f'<ellipse cx="{MOUTH[0]}" cy="{MOUTH[1]}" rx="44" ry="54" fill="{INK}"/>',
                behind=burst(640, 250, 120, 250, 11, ORANGE) + burst(640, 262, 70, 150, 9, GOLD, 0.2)))
made.append(svg("sleep", "waiting for the pump", face(eyes=None),
                closed_eyes() + f'<ellipse cx="728" cy="888" rx="24" ry="28" fill="{INK}"/>'
                + f'<circle cx="800" cy="832" r="44" fill="{TEAR}" fill-opacity=".75" stroke="{INK}" stroke-width="14"/><circle cx="786" cy="818" r="10" fill="#fff"/>'
                + zed(1000, 330, 90) + zed(1070, 220, 64) + zed(1100, 140, 40)))
made.append(svg("pls", "pls pump", face(),
                '<g fill="#fff"><circle cx="520" cy="585" r="26"/><circle cx="612" cy="752" r="15"/><circle cx="792" cy="628" r="22"/><circle cx="870" cy="782" r="13"/></g>'
                + stroke("M478 508 Q556 470 640 452", 30) + stroke("M772 492 Q846 500 924 536", 30)
                + stroke("M688 886 Q710 868 732 886 Q754 904 776 886", 30)))
made.append(svg("drool", "wen airdrop", face(),
                shape("M662 850 Q736 870 806 846 Q800 918 736 922 Q670 918 662 850Z", INK, 14) + drop(810, 968, 50, tilt=180)))
made.append(svg("angel", "i would never rug", face(eyes=None), happy_eyes(40) + smile(),
                behind=outlined("M470 150 A170 44 0 1 0 810 150 A170 44 0 1 0 470 150Z", 34, GOLD)))
made.append(svg("upside", "rugged", face(), smile(), wrap="rotate(180 627 590)"))
clip, _ = lids(596, 632, 6)
parts = [trace(SILHOUETTE, "#fff"), trace(RING)] + [trace(c) for c in CRATERS]
parts.append(f'<g clip-path="url(#lid)">{eye_ovals()}<circle cx="652" cy="652" r="40" fill="#fff"/><circle cx="906" cy="690" r="34" fill="#fff"/></g>')
made.append(svg("shifty", "watching the chart", (clip, "".join(parts)),
                stroke("M440 590 L712 602", 34) + stroke("M730 626 L960 638", 34) + stroke("M712 890 H800", 36)))
made.append(svg("hmm", "dyor", face(), stroke("M492 520 L646 520", 34) + stroke("M772 520 Q846 440 928 488", 34)
                + stroke("M676 894 Q730 880 800 868", 36)))
made.append(svg("grimace", "it's fine", face(),
                shape("M650 850 H806 Q818 850 818 862 V914 Q818 926 806 926 H650 Q638 926 638 914 V862 Q638 850 650 850Z", "#fff", 22)
                + stroke("M680 852 V924 M716 852 V924 M752 852 V924 M786 852 V924 M640 888 H816", 12) + drop(1000, 420, 80, tilt=18)))
def arrow(points, color):
    """A chart line with an arrowhead on its last segment."""
    (ax, ay), (bx, by) = points[-2], points[-1]
    n = math.hypot(bx - ax, by - ay)
    dx, dy = (bx - ax) / n, (by - ay) / n
    tip = (bx + dx * 100, by + dy * 100)
    head = f"M{tip[0]:.0f} {tip[1]:.0f} L{bx - dy*80:.0f} {by + dx*80:.0f} L{bx + dy*80:.0f} {by - dx*80:.0f}Z"
    line = "M" + " L".join(f"{x} {y}" for x, y in points)
    return outlined(line, 54, color, 30) + shape(head, color, 16)


made.append(svg("rocket", "lfg", face(), grin(),
                # a long exhaust under the body; the wrap shrinks, tilts and lifts it, so it trails off bottom-left
                behind=f'<g transform="rotate(180 627 930)">{flame(627, 930, 420, 700, ORANGE)}{flame(627, 930, 250, 450, GOLD)}</g>'
                + outlined("M340 1000 L340 1240", 22, "#fff") + outlined("M914 1000 L914 1200", 22, "#fff"),
                wrap="translate(724 452) rotate(35) scale(.7) translate(-627 -590)"))
made.append(svg("fire", "it's pumping", face(), grin(),
                behind=flame(640, 520, 620, 460, ORANGE) + flame(640, 520, 420, 330, GOLD)))
made.append(svg("pump", "number go up", face(), grin() + arrow([(230, 1010), (470, 830), (600, 900), (990, 620)], GREEN)))
made.append(svg("dump", "number go down", face(eyes=None), pupils(r=(26, 22)) + drop(1000, 420, 80, tilt=18)
                + arrow([(220, 560), (470, 790), (600, 720), (990, 1000)], RED)))
made.append(svg("moon", "gm", face()))

made = [m for m in made if m]
print(f"{len(made)} moojis -> {os.path.relpath(OUT)}")
