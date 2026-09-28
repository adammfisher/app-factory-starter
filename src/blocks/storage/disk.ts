// The storage block's disk on iOS and Android: a folder in the app's documents directory, through
// expo-file-system. The web uses web-disk.ts instead.
import { Directory, File, Paths } from 'expo-file-system';

import type { Disk, StoredFile } from './store';

function folderSize(dir: Directory): number {
  let total = 0;
  for (const entry of dir.list()) total += entry instanceof File ? (entry.size ?? 0) : folderSize(entry);
  return total;
}

export function fileDisk(name: string): Disk {
  const root = new Directory(Paths.document, name);
  const fileAt = (path: string) => new File(root, ...path.split('/'));

  // Makes the folders above path and returns the file there, ready to be written.
  function writable(path: string): File {
    const parts = path.split('/');
    new Directory(root, ...parts.slice(0, -1)).create({ intermediates: true, idempotent: true });
    const file = fileAt(path);
    if (!file.exists) file.create();
    return file;
  }

  return {
    async readText(path) {
      const file = fileAt(path);
      return file.exists ? file.text() : null;
    },
    async writeText(path, text) {
      writable(path).write(text);
    },
    async writeBytes(path, bytes) {
      writable(path).write(bytes);
    },
    async remove(path) {
      const file = fileAt(path);
      if (file.exists) file.delete();
    },
    async files(dir): Promise<StoredFile[]> {
      const folder = new Directory(root, dir);
      if (!folder.exists) return [];
      return folder.list().flatMap((entry) => (entry instanceof File ? [{ name: entry.name, size: entry.size ?? 0 }] : []));
    },
    async size(path) {
      const file = fileAt(path);
      return file.exists ? (file.size ?? 0) : 0;
    },
    async used() {
      return root.exists ? folderSize(root) : 0;
    },
    async free() {
      return Paths.availableDiskSpace;
    },
  };
}
