import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  readdir,
  unlink,
} from 'node:fs/promises';
const base = 'public/ffmpeg';
await mkdir(base + '/client', { recursive: true });
await copyFile(
  'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',
  base + '/ffmpeg-core.js',
);
for (const name of await readdir('node_modules/@ffmpeg/ffmpeg/dist/esm'))
  if (name.endsWith('.js'))
    await copyFile(
      'node_modules/@ffmpeg/ffmpeg/dist/esm/' + name,
      base + '/client/' + name,
    );
const bytes = await readFile(
  'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
);
const parts = [];
for (let at = 0; at < bytes.length; at += 8 * 1024 * 1024) {
  const name = 'core.part' + parts.length;
  await writeFile(base + '/' + name, bytes.subarray(at, at + 8 * 1024 * 1024));
  parts.push(name);
}
await writeFile(
  base + '/core.json',
  JSON.stringify({ parts, bytes: bytes.length }),
);
await unlink(base + '/ffmpeg-core.wasm').catch((e) => {
  if (e.code !== 'ENOENT') throw e;
});
console.log(
  'FFmpeg prepared: ' + parts.length + ' parts, ' + bytes.length + ' bytes.',
);
