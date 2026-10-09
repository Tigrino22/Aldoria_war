// Textures procédurales peintes sur canvas : pierre, bois, chaume, tuiles, herbe, terre…
// Chaque texture couvre `world` mètres : les UV des objets sont calculées en mètres puis divisées par cette taille.
import * as THREE from 'three';

let seed = 1;
export const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
export const setSeed = (s) => (seed = s);
const range = (a, b) => a + rand() * (b - a);

// ---------- Bruit de valeur ----------
const P = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const V = new Float32Array(256).map(() => rand());
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (a) => ((a % period) + period) % period;
  const h = (i, j) => V[P[(P[w(i) & 255] + w(j)) & 255]];
  const u = fade(xf), v = fade(yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Bruit fractal raccordable (la texture se répète sans couture). */
export function fbm(x, y, base = 8, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * base * f, y * base * f, base * f);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, v * k)) | 0).join(',')})`;

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

/** Remplit le canvas avec un bruit coloré entre deux teintes. */
function noiseFill(ctx, size, c1, c2, base = 6, contrast = 1.4) {
  const img = ctx.getImageData(0, 0, size, size);
  const A = hex(c1), B = hex(c2);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = Math.min(1, Math.max(0, (fbm(x / size, y / size, base) - 0.5) * contrast + 0.5));
      const c = mix(A, B, n);
      const i = (y * size + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/** Grain fin multiplicatif, pour casser l'aspect lisse. */
function grain(ctx, size, amount = 18) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = (rand() - 0.5) * amount;
    img.data[i] += g;
    img.data[i + 1] += g;
    img.data[i + 2] += g;
  }
  ctx.putImageData(img, 0, 0);
}

function wrapDraw(size, fn) {
  // Dessine 9 fois pour que les formes qui dépassent se raccordent sur les bords.
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

// ---------- Générateurs ----------
const GEN = {
  // ---------- Matières des personnages ----------
  mail(ctx, s) {
    // Cotte de mailles : anneaux imbriqués en quinconce.
    ctx.fillStyle = '#2a2b2e';
    ctx.fillRect(0, 0, s, s);
    const n = 32, step = s / n;
    for (let row = 0; row < n * 1.5 + 2; row++)
      for (let col = -1; col <= n; col++) {
        const x = col * step + (row % 2 ? step / 2 : 0), y = row * step * 0.62;
        wrapDraw(s, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx - 2, y + dy - 2, 1, x + dx, y + dy, step * 0.55);
          g.addColorStop(0, '#d8dade');
          g.addColorStop(0.6, '#8a8d93');
          g.addColorStop(1, '#3a3b3f');
          ctx.strokeStyle = g;
          ctx.lineWidth = step * 0.22;
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, step * 0.42, step * 0.34, 0, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
    grain(ctx, s, 14);
  },
  quilt(ctx, s) {
    // Toile de lin écrue du gambison (le matelassage est sculpté) : trame, salissures, taches.
    noiseFill(ctx, s, '#6e5c40', '#9c8862', 5, 1.5);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const weave = (x % 3 === 0 ? -0.05 : 0) + (y % 3 === 0 ? -0.04 : 0);
        const dirt = Math.max(0, fbm(x / s + 5.3, y / s + 2.1, 4, 3) - 0.55) * 1.2;
        const i = (y * s + x) * 4;
        for (let k = 0; k < 3; k++) img.data[i + k] *= 1 + weave - dirt;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 22);
  },
  paint(ctx, s) {
    // Peinture usée sur bois (teinte donnée par le matériau) : écaillures, coups, crasse.
    noiseFill(ctx, s, '#a8a8a8', '#d8d8d8', 5, 1.3);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const chip = fbm(x / s + 9.1, y / s, 14, 3);
        const grainWood = Math.sin(y * 0.35 + fbm(x / s, y / s, 6) * 20) * 0.04;
        if (chip > 0.68) {
          // Bois nu sous la peinture écaillée.
          img.data[i] = 120; img.data[i + 1] = 92; img.data[i + 2] = 60;
        } else for (let k = 0; k < 3; k++) img.data[i + k] *= 1 + grainWood - Math.max(0, chip - 0.55) * 1.5;
      }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(40,28,18,${range(0.15, 0.4)})`;
      ctx.lineWidth = range(0.8, 2);
      const x = rand() * s, y = rand() * s, a = rand() * Math.PI, l = range(8, 40);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    grain(ctx, s, 18);
  },
  wool(ctx, s) {
    noiseFill(ctx, s, '#b8b0a0', '#d8d0c0', 12, 1.1);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const w = (Math.sin(x * 1.6) * Math.sin(y * 1.6) + 1) * 0.06;
        const i = (y * s + x) * 4;
        for (let k = 0; k < 3; k++) img.data[i + k] *= 0.9 + w;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 22);
  },
  leather(ctx, s) {
    noiseFill(ctx, s, '#4a2e18', '#7a5232', 6, 1.6);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const n = Math.abs(fbm(x / s, y / s, 10) - 0.5);
        const i = (y * s + x) * 4;
        if (n < 0.02) for (let k = 0; k < 3; k++) img.data[i + k] *= 0.75;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 18);
  },
  skin(ctx, s) {
    noiseFill(ctx, s, '#a87058', '#c48e70', 10, 1.3);
    grain(ctx, s, 8);
  },
  hair(ctx, s) {
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * s, y = rand() * s, len = range(20, 60);
      ctx.strokeStyle = rgb(mix(hex('#24160c'), hex('#6a4a2c'), rand()));
      ctx.lineWidth = range(0.8, 2);
      wrapDraw(s, (dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + range(-4, 4), y + dy + len);
        ctx.stroke();
      });
    }
  },
  steel(ctx, s) {
    noiseFill(ctx, s, '#8a8d92', '#a8abb0', 4, 1.0);
    // Brossage horizontal et petites marques de coups.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${range(0.02, 0.06)})`;
      ctx.fillRect(0, rand() * s, s, range(0.5, 2));
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(40,30,20,0.15)';
      ctx.beginPath();
      ctx.arc(rand() * s, rand() * s, range(2, 8), 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, s, 10);
  },
  coat(ctx, s) {
    // Robe de cheval : poil fin orienté.
    noiseFill(ctx, s, '#7a4a2a', '#9a6438', 5, 1.3);
    for (let i = 0; i < 6000; i++) {
      const x = rand() * s, y = rand() * s;
      ctx.strokeStyle = `rgba(${rand() < 0.5 ? '30,18,8' : '150,105,70'},0.18)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + range(6, 12), y + range(-1, 1));
      ctx.stroke();
    }
  },
  cloth(ctx, s) {
    // Drap teint (la couleur vient du matériau) : trame fine et légers plis.
    noiseFill(ctx, s, '#c8c8c8', '#ececec', 6, 1.0);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const weave = ((x % 4 < 2) !== (y % 4 < 2) ? 0.04 : -0.04);
        const i = (y * s + x) * 4;
        for (let k = 0; k < 3; k++) img.data[i + k] *= 0.95 + weave;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 14);
  },

  stone(ctx, s) {
    noiseFill(ctx, s, '#4d4a44', '#6b675f', 10);
    let y = 0;
    while (y < s) {
      const h = range(38, 58);
      let x = range(-40, 0);
      while (x < s) {
        const w = range(60, 110);
        const tone = range(0.8, 1.15);
        const base = mix(hex('#8c8576'), hex('#a39b8a'), rand());
        ctx.fillStyle = rgb(base, tone);
        const r = 6;
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, w - 6, h - 6, r);
        ctx.fill();
        // relief : lumière en haut à gauche, ombre en bas à droite
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x + 5, y + 4, w - 10, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 5, y + h - 8, w - 10, 4);
        x += w;
      }
      y += h;
    }
    const img = ctx.getImageData(0, 0, s, s);
    for (let yy = 0; yy < s; yy++)
      for (let xx = 0; xx < s; xx++) {
        const n = fbm(xx / s, yy / s, 16) - 0.5;
        const i = (yy * s + xx) * 4;
        for (let k = 0; k < 3; k++) img.data[i + k] += n * 50;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 22);
  },
  planks(ctx, s) {
    const n = 8;
    const w = s / n;
    for (let i = 0; i < n; i++) {
      const base = mix(hex('#6e4a2c'), hex('#8a6240'), rand());
      ctx.fillStyle = rgb(base);
      ctx.fillRect(i * w, 0, w, s);
      for (let g = 0; g < 14; g++) {
        ctx.strokeStyle = `rgba(40,22,10,${range(0.08, 0.25)})`;
        ctx.lineWidth = range(0.6, 1.8);
        const x0 = i * w + range(3, w - 3);
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        for (let y = 0; y <= s; y += 16) ctx.lineTo(x0 + Math.sin(y / range(30, 60) + g) * 2, y);
        ctx.stroke();
      }
      // joints entre les planches
      ctx.fillStyle = 'rgba(25,14,6,0.75)';
      ctx.fillRect(i * w, 0, 3, s);
      ctx.fillStyle = 'rgba(255,230,190,0.08)';
      ctx.fillRect(i * w + 3, 0, 2, s);
      // coupe horizontale aléatoire
      const cut = range(0, s);
      ctx.fillStyle = 'rgba(25,14,6,0.6)';
      ctx.fillRect(i * w, cut, w, 3);
    }
    grain(ctx, s, 16);
  },
  logs(ctx, s) {
    // rondins horizontaux empilés (mur de cabane)
    const n = 7;
    const h = s / n;
    for (let i = 0; i < n; i++) {
      const g = ctx.createLinearGradient(0, i * h, 0, (i + 1) * h);
      const base = mix(hex('#5e3e22'), hex('#7a5232'), rand());
      g.addColorStop(0, rgb(base, 0.55));
      g.addColorStop(0.25, rgb(base, 1.15));
      g.addColorStop(0.7, rgb(base, 0.95));
      g.addColorStop(1, rgb(base, 0.45));
      ctx.fillStyle = g;
      ctx.fillRect(0, i * h, s, h);
      for (let k = 0; k < 10; k++) {
        ctx.strokeStyle = `rgba(30,16,6,${range(0.1, 0.3)})`;
        ctx.lineWidth = 1;
        const y0 = i * h + range(4, h - 4);
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(s / 3, y0 + range(-3, 3), (2 * s) / 3, y0 + range(-3, 3), s, y0);
        ctx.stroke();
      }
    }
    grain(ctx, s, 14);
  },
  thatch(ctx, s) {
    noiseFill(ctx, s, '#6b5428', '#9c8044', 8);
    for (let i = 0; i < 9000; i++) {
      const x = range(0, s), y = range(0, s);
      const len = range(18, 40);
      const c = mix(hex('#8a6d34'), hex('#d1b46a'), rand());
      wrapDraw(s, (dx, dy) => {
        ctx.strokeStyle = rgb(c, range(0.7, 1.1));
        ctx.lineWidth = range(0.8, 1.8);
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + range(-3, 3), y + dy + len);
        ctx.stroke();
      });
    }
    // couches horizontales du chaume
    for (let y = 0; y < s; y += 64) {
      const g = ctx.createLinearGradient(0, y, 0, y + 64);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, 64);
    }
  },
  tiles(ctx, s) {
    // tuiles canal en terre cuite ; rangées horizontales
    ctx.fillStyle = '#4a2416';
    ctx.fillRect(0, 0, s, s);
    const rows = 8, cols = 10;
    const h = s / rows, w = s / cols;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0);
        const base = mix(hex('#8e3b24'), hex('#b5583a'), rand());
        wrapDraw(s, (dx) => {
          const g = ctx.createLinearGradient(x + dx, 0, x + dx + w, 0);
          g.addColorStop(0, rgb(base, 0.55));
          g.addColorStop(0.45, rgb(base, 1.15));
          g.addColorStop(1, rgb(base, 0.6));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(x + dx + 1, r * h + 1, w - 2, h + 6, [2, 2, w / 2, w / 2]);
          ctx.fill();
        });
      }
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, r * h, s, 3);
    }
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const n = fbm(x / s, y / s, 6) - 0.5;
        const i = (y * s + x) * 4;
        img.data[i] += n * 40;
        img.data[i + 1] += n * 30;
        img.data[i + 2] += n * 20;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 14);
  },
  shingles(ctx, s) {
    ctx.fillStyle = '#2e2620';
    ctx.fillRect(0, 0, s, s);
    const rows = 10, cols = 9;
    const h = s / rows, w = s / cols;
    for (let r = 0; r < rows; r++)
      for (let c = -1; c < cols; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0) + range(-3, 3);
        const ww = w * range(0.8, 1.05);
        const base = mix(hex('#5a5048'), hex('#7d6e60'), rand());
        ctx.fillStyle = rgb(base, range(0.85, 1.1));
        ctx.fillRect(x + 1, r * h, ww - 2, h + 4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x + 1, r * h + h, ww - 2, 3);
      }
    grain(ctx, s, 24);
  },
  plaster(ctx, s) {
    noiseFill(ctx, s, '#b9ad94', '#e0d6c0', 5, 1.6);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(90,75,55,${range(0.03, 0.08)})`;
      ctx.beginPath();
      ctx.ellipse(range(0, s), range(0, s), range(10, 60), range(6, 30), rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, s, 14);
  },
  timber(ctx, s) {
    noiseFill(ctx, s, '#3a2614', '#5a3b20', 12);
    for (let g = 0; g < 50; g++) {
      ctx.strokeStyle = `rgba(20,10,4,${range(0.15, 0.35)})`;
      ctx.lineWidth = range(0.5, 1.5);
      const y0 = range(0, s);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(s / 3, y0 + range(-6, 6), (2 * s) / 3, y0 + range(-6, 6), s, y0);
      ctx.stroke();
    }
    grain(ctx, s, 14);
  },
  grass(ctx, s) {
    noiseFill(ctx, s, '#4a6b2a', '#7a9440', 4, 1.8);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const n = fbm(x / s + 3.1, y / s + 1.7, 24, 2) - 0.5;
        const i = (y * s + x) * 4;
        img.data[i] += n * 30;
        img.data[i + 1] += n * 36;
        img.data[i + 2] += n * 12;
      }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 14000; i++) {
      const x = range(0, s), y = range(0, s);
      const c = mix(hex('#3d5a20'), hex('#9cb158'), rand());
      ctx.strokeStyle = rgb(c);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + range(-2, 2), y - range(3, 7));
      ctx.stroke();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(235,225,150,0.7)' : 'rgba(240,240,240,0.6)';
      ctx.fillRect(range(0, s), range(0, s), 2, 2);
    }
  },
  dirt(ctx, s) {
    noiseFill(ctx, s, '#6e5537', '#9a7d55', 6, 1.6);
    for (let i = 0; i < 900; i++) {
      const c = mix(hex('#5a4630'), hex('#b8a07a'), rand());
      ctx.fillStyle = rgb(c);
      ctx.beginPath();
      ctx.ellipse(range(0, s), range(0, s), range(1, 4), range(1, 3), rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, s, 20);
  },
  clay(ctx, s) {
    noiseFill(ctx, s, '#6e4a34', '#a0704c', 5, 1.6);
    grain(ctx, s, 22);
  },
  brick(ctx, s) {
    ctx.fillStyle = '#6b5a4a';
    ctx.fillRect(0, 0, s, s);
    const rows = 16, w = s / 6, h = s / rows;
    for (let r = 0; r < rows; r++)
      for (let c = -1; c < 7; c++) {
        const base = mix(hex('#8a3c26'), hex('#b35a3a'), rand());
        ctx.fillStyle = rgb(base, range(0.8, 1.1));
        ctx.fillRect(c * w + (r % 2 ? w / 2 : 0) + 2, r * h + 2, w - 4, h - 4);
      }
    grain(ctx, s, 20);
  },
  rock(ctx, s) {
    noiseFill(ctx, s, '#5e5a52', '#8a857a', 5, 1.6);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const n = Math.abs(fbm(x / s, y / s, 12) - 0.5);
        const i = (y * s + x) * 4;
        if (n < 0.012) for (let k = 0; k < 3; k++) img.data[i + k] *= 0.78;
      }
    ctx.putImageData(img, 0, 0);
    grain(ctx, s, 26);
  },
  field(ctx, s) {
    noiseFill(ctx, s, '#6b5a30', '#8a7440', 6);
    const rows = 16;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * (s / rows);
      for (let x = 0; x < s; x += 2) {
        const c = mix(hex('#a08a3a'), hex('#e0c870'), rand());
        ctx.strokeStyle = rgb(c);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y + range(-6, 6));
        ctx.lineTo(x + range(-1, 1), y - range(8, 16));
        ctx.stroke();
      }
    }
  },
  leaves(ctx, s) {
    noiseFill(ctx, s, '#22381a', '#4d6e2c', 8, 2);
    for (let i = 0; i < 6000; i++) {
      const c = mix(hex('#2b4a1c'), hex('#7d9a42'), rand());
      ctx.fillStyle = rgb(c);
      ctx.beginPath();
      ctx.ellipse(range(0, s), range(0, s), range(2, 5), range(1, 3), rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  pine(ctx, s) {
    noiseFill(ctx, s, '#1b2e1a', '#355234', 8, 2);
    for (let i = 0; i < 7000; i++) {
      const c = mix(hex('#1e3420'), hex('#4f6d44'), rand());
      ctx.strokeStyle = rgb(c);
      ctx.lineWidth = 1;
      const x = range(0, s), y = range(0, s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + range(-5, 5), y + range(2, 6));
      ctx.stroke();
    }
  },
  bark(ctx, s) {
    noiseFill(ctx, s, '#3a2a1c', '#5c4430', 10);
    for (let i = 0; i < 80; i++) {
      ctx.strokeStyle = `rgba(20,12,6,${range(0.2, 0.5)})`;
      ctx.lineWidth = range(1, 3);
      const x = range(0, s);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y < s; y += 20) ctx.lineTo(x + range(-4, 4), y);
      ctx.stroke();
    }
  },
  canvasCloth(ctx, s) {
    noiseFill(ctx, s, '#b8ab8c', '#d8ceb4', 6);
    for (let i = 0; i < s; i += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(i, 0, 1, s);
      ctx.fillRect(0, i, s, 1);
    }
    grain(ctx, s, 12);
  },
  water(ctx, s) {
    noiseFill(ctx, s, '#2c4a5a', '#4f7686', 6, 1.6);
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(220,240,255,${range(0.05, 0.2)})`;
      ctx.lineWidth = 1;
      const x = range(0, s), y = range(0, s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 10, y - 3, x + 20, y);
      ctx.stroke();
    }
  },
  slate(ctx, s) {
    ctx.fillStyle = '#1f2326';
    ctx.fillRect(0, 0, s, s);
    const rows = 12, cols = 10;
    const h = s / rows, w = s / cols;
    for (let r = 0; r < rows; r++)
      for (let c = -1; c < cols; c++) {
        const base = mix(hex('#3d454b'), hex('#5c666d'), rand());
        ctx.fillStyle = rgb(base, range(0.85, 1.1));
        ctx.fillRect(c * w + (r % 2 ? w / 2 : 0) + 1, r * h, w - 2, h + 3);
      }
    grain(ctx, s, 18);
  },
  iron(ctx, s) {
    noiseFill(ctx, s, '#2a2a2c', '#55565a', 10);
    grain(ctx, s, 26);
  },
  ore(ctx, s) {
    noiseFill(ctx, s, '#3a3532', '#5e5650', 10, 2);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(160,80,50,0.7)' : 'rgba(30,30,30,0.6)';
      ctx.beginPath();
      ctx.arc(range(0, s), range(0, s), range(2, 6), 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** Taille réelle (en mètres) couverte par une répétition de chaque texture. */
export const WORLD = {
  stone: 3, planks: 2.4, logs: 2.2, thatch: 2.5, tiles: 2, shingles: 2.2, plaster: 3, timber: 1, grass: 6, dirt: 5,
  clay: 4, brick: 1.6, rock: 4, field: 4, leaves: 2, pine: 2, bark: 1, canvasCloth: 2, water: 4, slate: 2, iron: 1, ore: 2,
  mail: 0.3, quilt: 0.25, paint: 0.7, wool: 0.4, leather: 0.6, skin: 0.5, hair: 0.25, steel: 0.8, coat: 0.8, cloth: 0.5,
};

const cache = {};
export function texture(name) {
  if (cache[name]) return cache[name];
  setSeed(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000 + 1);
  const [c, ctx] = canvas(512);
  GEN[name](ctx, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (cache[name] = t);
}
