// IndexedDB accommodates full two-minute recordings without the small synchronous
// sessionStorage quota. Replay is consumed once, including when parsing fails.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fpv-recordings", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeReplay(text: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").put(text, "replay");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function consumeReplay(): Promise<string | undefined> {
  const db = await database();
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction("pending", "readwrite");
      const store = tx.objectStore("pending");
      const request = store.get("replay");
      let value: string | undefined;
      request.onsuccess = () => {
        value = request.result;
        store.delete("replay");
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
