export class Database {
  private db?: Promise<IDBDatabase>;
  private open() {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('AnimeSub', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('cache');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db.transaction('cache', 'readonly').objectStore('cache').get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  }
  async put<T>(key: string, value: T) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async delete(key: string) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async prune(now = Date.now(), maxEntries = 500): Promise<number> {
    const db = await this.open();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      const store = tx.objectStore('cache');
      const req = store.openCursor();
      let pruned = 0;
      let validCount = 0;

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;

        const val = cursor.value;
        const isObject = typeof val === 'object' && val !== null;
        const isExpired =
          isObject &&
          ((typeof val.expiresAt === 'number' && val.expiresAt <= now) ||
            (typeof val.at === 'number' && now - val.at >= 86400000));

        if (isExpired) {
          cursor.delete();
          pruned++;
        } else {
          validCount++;
          if (validCount > maxEntries) {
            cursor.delete();
            pruned++;
          }
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(pruned);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async clear() {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
export const database = new Database();
