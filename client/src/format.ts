export const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR');

export function duration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function clockTime(iso: string | Date): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `aujourd'hui à ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`;
}

export const coords = (v: { x: number; y: number }) => `${v.x}|${v.y}`;
