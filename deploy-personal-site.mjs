import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import Arweave from 'arweave';
import { ArweaveSigner, createData } from 'arbundles';
import sharp from 'sharp';
import { build } from 'vite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(ROOT, '.arweave-deploy');
export const UPLOAD_URL = 'https://up.arweave.net/tx';
export const PAYLOAD_LIMIT = 96 * 1024;
export const SIGNED_LIMIT = 100 * 1024;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

export async function collectFiles(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name;
    if (!/^[a-zA-Z0-9._/-]+$/.test(name))
      throw new Error(
        `Unsafe manifest path: ${name}. Use filenames without spaces or URL-encoded characters.`,
      );
    if (entry.isSymbolicLink() || entry.name.startsWith('.'))
      throw new Error(`Refusing hidden file or symlink: ${name}`);
    if (entry.isDirectory())
      files.push(...(await collectFiles(path.join(directory, entry.name), `${name}/`)));
    else if (entry.isFile()) {
      const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()];
      if (!contentType)
        throw new Error(
          `Unexpected build artifact: ${name}. Review it before adding a public file type.`,
        );
      files.push({ name, contentType, data: await readFile(path.join(directory, entry.name)) });
    }
  }
  return files;
}

export async function fitFreeSize(file) {
  if (file.data.length <= PAYLOAD_LIMIT) return file.data;
  const extension = path.extname(file.name).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    throw new Error(
      `${file.name} exceeds the free upload budget. Reduce it before deploying; paid uploads are disabled.`,
    );
  }
  const metadata = await sharp(file.data).metadata();
  if (metadata.pages > 1) throw new Error(`Refusing to flatten animated image: ${file.name}`);
  // Deployment copies only. Retain the file format, transparency, orientation, and aspect ratio.
  for (const dimension of [1280, 1024, 800, 640]) {
    for (const quality of [85, 75, 65]) {
      let pipeline = sharp(file.data)
        .autoOrient()
        .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true });
      if (extension === '.png') pipeline = pipeline.png({ palette: true, quality, effort: 10 });
      else if (extension === '.webp') pipeline = pipeline.webp({ quality });
      else pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      const data = await pipeline.toBuffer();
      if (data.length <= PAYLOAD_LIMIT) return data;
    }
  }
  throw new Error(
    `${file.name} cannot fit the free tier at the allowed quality settings. No files have been uploaded.`,
  );
}

export function createManifest(paths) {
  if (!paths['index.html'] || !paths['career/index.html'] || !paths['jon-williams-resume.pdf']) {
    throw new Error('The build must contain the homepage, career page, and resume PDF.');
  }
  if (!paths['analytics/index.html']) throw new Error('The build must contain the analytics page.');
  return {
    manifest: 'arweave/paths',
    version: '0.2.0',
    index: { path: 'index.html' },
    paths: {
      ...paths,
      'career/': paths['career/index.html'],
      'analytics/': paths['analytics/index.html'],
    },
  };
}

export async function prepareDeployment(
  buildDirectory = path.join(ROOT, 'dist'),
  stateDirectory = STATE,
) {
  const files = await collectFiles(buildDirectory);
  // Validate the complete publication set before generating a wallet or making any network requests.
  for (const file of files) {
    file.originalBytes = file.data.length;
    file.data = await fitFreeSize(file);
  }
  const placeholderPaths = Object.fromEntries(
    files.map((file) => [file.name, { id: 'A'.repeat(43) }]),
  );
  const manifest = createManifest(placeholderPaths);
  if (Buffer.byteLength(JSON.stringify(manifest)) > PAYLOAD_LIMIT)
    throw new Error('Manifest exceeds the free upload budget.');
  await mkdir(stateDirectory, { recursive: true });
  const stage = await mkdtemp(path.join(stateDirectory, 'site-'));
  for (const file of files) {
    const destination = path.join(stage, file.name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.data);
  }
  const report = {
    stage,
    payloadLimit: PAYLOAD_LIMIT,
    signedLimit: SIGNED_LIMIT,
    files: files.map(({ name, contentType, originalBytes, data }) => ({
      name,
      contentType,
      originalBytes,
      uploadBytes: data.length,
    })),
    totalBytes: files.reduce((sum, file) => sum + file.data.length, 0),
    manifest,
  };
  await writeFile(path.join(stateDirectory, 'plan.json'), JSON.stringify(report, null, 2) + '\n');
  return { files, stage, report };
}

export async function uploadSigned(item, { fetcher = fetch, wait = sleep, attempts = 3 } = {}) {
  const raw = item.getRaw();
  if (raw.length > SIGNED_LIMIT)
    throw new Error('Signed data item exceeds the free-only size limit.');
  // Sign once outside the retry loop: a retry always resends the same transaction ID.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(UPLOAD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: raw,
        signal: AbortSignal.timeout(45_000),
        redirect: 'error',
      });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(
          response.status === 402
            ? 'Free upload refused or allowance exhausted. No payment will be attempted.'
            : `Upload failed (HTTP ${response.status}).`,
        );
        error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      let receipt;
      try {
        receipt = JSON.parse(body);
      } catch {
        receipt = { id: body.trim() };
      }
      if (typeof receipt === 'string') receipt = { id: receipt };
      if (receipt?.id !== item.id)
        throw new Error('Uploader returned a missing or mismatched transaction ID.');
      if (receipt.winc !== undefined && String(receipt.winc) !== '0')
        throw new Error('Uploader reported a nonzero charge; stopping deployment.');
      return receipt;
    } catch (error) {
      const retryable =
        error.retryable ??
        (error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name));
      if (!retryable || attempt === attempts) throw error;
      console.log(`  Retrying the same signed item (${attempt + 1}/${attempts})...`);
      await wait(1500 * attempt);
    }
  }
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function loadWallet() {
  const filename = path.join(STATE, 'wallet.json');
  let wallet = await readJson(filename, null);
  if (!wallet) {
    wallet = await Arweave.init({}).wallets.generate();
    await writeFile(filename, JSON.stringify(wallet) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Created a dedicated, unfunded deployment wallet in .arweave-deploy/wallet.json.');
  }
  return wallet;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(
      'node deploy-personal-site.mjs [--dry-run]\n\nBuilds Vite and prepares free-size assets. --dry-run creates a local preview only.\nWithout --dry-run, permanently uploads to https://up.arweave.net/tx.\nNo paid fallback, top-ups, or wallet rotation. Keep .arweave-deploy/wallet.json private.',
    );
    return;
  }
  if (args.some((arg) => arg !== '--dry-run')) throw new Error('Unknown option. Use --help.');
  await build({ root: ROOT });
  const { files, stage, report } = await prepareDeployment();
  console.table(
    report.files.map(({ name, originalBytes, uploadBytes }) => ({
      file: name,
      originalKiB: (originalBytes / 1024).toFixed(1),
      uploadKiB: (uploadBytes / 1024).toFixed(1),
    })),
  );
  console.log(
    `Prepared ${(report.totalBytes / 1024).toFixed(1)} KiB in ${files.length} files.\nPreview: npx vite preview --outDir "${stage}" --port 5174`,
  );
  if (args.includes('--dry-run')) {
    console.log(
      'Dry run complete. No wallet created, no upload requests sent. Plan: .arweave-deploy/plan.json',
    );
    return;
  }
  const jwk = await loadWallet();
  const address = await Arweave.init({}).wallets.jwkToAddress(jwk);
  const signer = new ArweaveSigner(jwk);
  const cachePath = path.join(STATE, 'uploads.json');
  const cache = await readJson(cachePath, {});
  const paths = {};
  const signedFiles = [];
  for (const file of files) {
    const key = createHash('sha256')
      .update(JSON.stringify([UPLOAD_URL, address, file.name, file.contentType]))
      .update(file.data)
      .digest('hex');
    if (cache[key]?.id?.match(/^[a-zA-Z0-9_-]{43}$/)) {
      paths[file.name] = { id: cache[key].id };
      continue;
    }
    const item = createData(file.data, signer, {
      tags: [
        { name: 'Content-Type', value: file.contentType },
        { name: 'App-Name', value: 'Jon-Williams-Personal-Site' },
        { name: 'Type', value: 'app-asset' },
        { name: 'File-Path', value: file.name },
      ],
    });
    await item.sign(signer);
    if (item.getRaw().length > SIGNED_LIMIT)
      throw new Error(`Signed file exceeds free limit: ${file.name}. Nothing uploaded.`);
    paths[file.name] = { id: item.id };
    signedFiles.push({ file, item, key });
  }
  const manifest = createManifest(paths);
  const manifestItem = createData(JSON.stringify(manifest), signer, {
    tags: [
      { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
      { name: 'App-Name', value: 'Jon-Williams-Personal-Site' },
      { name: 'Type', value: 'manifest' },
    ],
  });
  await manifestItem.sign(signer);
  if (manifestItem.getRaw().length > SIGNED_LIMIT)
    throw new Error('Signed manifest exceeds free limit. Nothing uploaded.');
  console.log(
    `Uploading ${signedFiles.length} files; reusing ${files.length - signedFiles.length} previously accepted files.`,
  );
  for (const { file, item, key } of signedFiles) {
    console.log(`Uploading ${file.name}...`);
    const receipt = await uploadSigned(item);
    cache[key] = receipt;
    await writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n');
  }
  const receipt = await uploadSigned(manifestItem);
  const url = `https://arweave.net/${manifestItem.id}/`;
  await writeFile(
    path.join(STATE, 'latest.json'),
    JSON.stringify(
      {
        manifestId: manifestItem.id,
        url,
        careerUrl: `${url}career/`,
        analyticsUrl: `${url}analytics/`,
        receipt,
        manifest,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Upload service accepted the deployment. Gateway availability may take time.\nHome: ${url}\nCareer: ${url}career/\nAnalytics: ${url}analytics/\nResume: ${url}jon-williams-resume.pdf\nReceipt: .arweave-deploy/latest.json`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Deployment stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
