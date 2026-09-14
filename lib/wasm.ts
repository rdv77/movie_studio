export async function wasmUrl(signal?: AbortSignal) {
  const r = await fetch('/ffmpeg/core.json', { signal });
  if (!r.ok) throw new Error('Монтажный движок недоступен.');
  const manifest = (await r.json()) as { parts: string[]; bytes: number };
  const parts = await Promise.all(
    manifest.parts.map(async (name) => {
      if (!/^core\.part\d+$/.test(name))
        throw new Error('Некорректная часть движка.');
      const p = await fetch('/ffmpeg/' + name, { signal });
      if (!p.ok) throw new Error('Не удалось загрузить монтажный движок.');
      return p.arrayBuffer();
    }),
  );
  const blob = new Blob(parts, { type: 'application/wasm' });
  if (blob.size !== manifest.bytes)
    throw new Error('Монтажный движок загрузился не полностью.');
  return URL.createObjectURL(blob);
}
