import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'frontend', 'dist');
const outputFile = path.join(projectRoot, 'src', 'worker', 'generated', 'frontend-assets.js');

const mimeTypes = {
  '.css': 'text/css; charset=UTF-8',
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml; charset=UTF-8'
};

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }
      return [entryPath];
    })
  );

  return files.flat();
}

async function main() {
  const files = await listFiles(distDir);
  const assets = [];

  for (const filePath of files) {
    const relativePath = `/${path.relative(distDir, filePath).replace(/\\/g, '/')}`;
    const extension = path.extname(filePath);
    const body = await fs.readFile(filePath, 'utf8');
    const contentType = mimeTypes[extension] || 'text/plain; charset=UTF-8';

    assets.push(`  ${JSON.stringify(relativePath)}: {
    contentType: ${JSON.stringify(contentType)},
    body: ${JSON.stringify(body)}
  }`);

    if (relativePath === '/index.html') {
      assets.push(`  "/": {
    contentType: ${JSON.stringify(contentType)},
    body: ${JSON.stringify(body)}
  }`);
    }
  }

  const fileContents = `export const FRONTEND_ASSETS = {\n${assets.join(',\n')}\n};\n`;
  await fs.writeFile(outputFile, fileContents, 'utf8');
}

main().catch((error) => {
  console.error('Failed to generate frontend asset bundle:', error);
  process.exitCode = 1;
});
