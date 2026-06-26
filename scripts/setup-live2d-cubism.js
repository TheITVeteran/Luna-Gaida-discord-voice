import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'apps', 'desktop', 'public');
const OUT_FILE = path.join(OUT_DIR, 'live2dcubismcore.min.js');
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';

function dirname(filePath) {
  return path.dirname(filePath);
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        download(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(OUT_FILE)) {
    console.log('Cubism Core already present:', OUT_FILE);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Downloading Live2D Cubism Core…');
  const data = await download(CORE_URL);
  fs.writeFileSync(OUT_FILE, data);
  console.log('Saved:', OUT_FILE);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
