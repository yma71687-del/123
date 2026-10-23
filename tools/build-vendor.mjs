import { copyFile, mkdir, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('node_modules/three/package.json', root)));
if (pkg.version !== '0.160.0') throw new Error('Unexpected Three.js version');
await mkdir(new URL('frontend/vendor/', root), { recursive: true });
await copyFile(new URL('node_modules/three/build/three.min.js', root), new URL('frontend/vendor/three.min.js', root));
await copyFile(new URL('node_modules/three/LICENSE', root), new URL('frontend/vendor/THREE-LICENSE.txt', root));
console.log('Vendored Three.js 0.160.0 and license from integrity-checked npm dependency');
