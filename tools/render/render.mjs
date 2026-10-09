// Rend toutes les images du jeu : node tools/render/render.mjs [filtre]
// Lance un petit serveur HTTP local + Chromium headless (WebGL logiciel via SwiftShader).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../client/src/assets');
const only = process.argv[2];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const f = path.join(here, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(here) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });

const save = (file, dataUrl) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('✓', path.relative(out, file));
};
const want = (name) => !only || name.includes(only);

if (only === 'textures') {
  // Aide au réglage : toutes les textures procédurales dans tools/render/.preview/
  const names = await page.evaluate(() => window.textureNames());
  for (const n of names) save(`${here}/.preview/${n}.png`, await page.evaluate((t) => window.exportTexture(t), n));
  await browser.close();
  server.close();
  process.exit(0);
}

const BUILDINGS = ['townhall', 'barracks', 'warehouse', 'woodcutter', 'farm', 'claypit', 'ironmine', 'wall'];
for (const key of BUILDINGS)
  for (const stage of [1, 2, 3])
    if (want(`${key}-${stage}`)) save(`${out}/buildings/${key}-${stage}.png`, await page.evaluate(([k, s]) => window.renderBuilding(k, s), [key, stage]));
if (want('plot')) save(`${out}/buildings/plot.png`, await page.evaluate(() => window.renderBuilding('plot', 0)));

if (want('village')) {
  const v = await page.evaluate(() => window.renderScene('village'));
  save(`${out}/village-bg.png`, v.png);
  fs.writeFileSync(`${out}/village-spots.json`, JSON.stringify(v.spots, null, 2) + '\n');
  console.log('  emplacements', v.spots);
}
const MAP = { mapVillage1: 'village-1', mapVillage2: 'village-2', mapVillage3: 'village-3', mapBarbarian: 'barbarian', mapTrees: 'trees', mapHill: 'hill' };
for (const [scene, file] of Object.entries(MAP))
  if (want(scene)) save(`${out}/map/${file}.png`, (await page.evaluate((n) => window.renderScene(n), scene)).png);
for (const r of ['wood', 'clay', 'iron', 'wheat'])
  if (want(r)) save(`${out}/resources/${r}.png`, await page.evaluate((n) => window.renderIcon(n), r));
for (const u of ['spearman', 'swordsman', 'cavalry', 'noble'])
  if (want(u)) save(`${out}/units/${u}.png`, await page.evaluate((n) => window.renderIcon(n), u));
if (want('ground')) save(`${out}/map/ground.png`, await page.evaluate(() => window.exportTexture('grass')));

await browser.close();
server.close();
