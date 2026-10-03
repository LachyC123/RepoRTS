import type { SaveFile, SaveMeta } from '../sim/save/SaveGame';

/**
 * Save slots in IndexedDB. Snapshots are JSON (1-3 MB), gzip-compressed when the browser supports
 * CompressionStream. Storage can be unavailable (private windows, sandboxed previews): every call
 * fails soft with a readable error instead of throwing into the game loop.
 */
export type SlotId = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SLOTS: SlotId[] = ['auto', 'slot1', 'slot2', 'slot3'];
export const SLOT_LABEL: Record<SlotId, string> = { auto: 'Autosave', slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3' };

interface Row {
  slot: SlotId;
  meta: SaveMeta;
  /** gzip blob, or the raw JSON string where compression is unavailable */
  data: Blob | string;
}

const DB = 'crownshire-saves';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'slot' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error ?? new Error('Storage unavailable'));
      r.onblocked = () => rej(new Error('Storage blocked'));
    } catch (e) {
      rej(e);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

async function pack(json: string): Promise<Blob | string> {
  if (typeof CompressionStream === 'undefined') return json;
  try {
    const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(cs).blob();
  } catch {
    return json;
  }
}

async function unpack(data: Blob | string): Promise<string> {
  if (typeof data === 'string') return data;
  const ds = data.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).text();
}

export const saveStore = {
  async list(): Promise<{ slot: SlotId; meta: SaveMeta }[]> {
    try {
      const rows = await tx<Row[]>('readonly', (s) => s.getAll() as IDBRequest<Row[]>);
      return rows.map((r) => ({ slot: r.slot, meta: r.meta })).sort((a, b) => b.meta.savedAt - a.meta.savedAt);
    } catch {
      return [];
    }
  },
  async write(slot: SlotId, file: SaveFile): Promise<void> {
    const data = await pack(JSON.stringify(file));
    await tx('readwrite', (s) => s.put({ slot, meta: file.meta, data } satisfies Row));
  },
  async read(slot: SlotId): Promise<SaveFile | null> {
    const row = await tx<Row | undefined>('readonly', (s) => s.get(slot) as IDBRequest<Row | undefined>);
    if (!row) return null;
    return JSON.parse(await unpack(row.data)) as SaveFile;
  },
  async remove(slot: SlotId): Promise<void> {
    await tx('readwrite', (s) => s.delete(slot));
  },
};
