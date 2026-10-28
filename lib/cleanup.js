import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { collectFiles } from './utils.js';

const DAY = 1000 * 60 * 60 * 24;

export class Cleanup extends EventEmitter {
  // Шукає файли, старіші за days днів (за датою останньої модифікації)
  async findOldFiles(directory, days) {
    const { files, warnings } = await collectFiles(directory);
    const oldFiles = [];
    const now = Date.now();

    for (const filePath of files) {
      try {
        const stats = await fs.stat(filePath);
        const daysOld = (now - stats.mtime.getTime()) / DAY;

        if (daysOld > days) {
          const fileData = {
            path: filePath,
            size: stats.size,
            mtime: stats.mtime,
            daysOld: Math.floor(daysOld),
          };
          oldFiles.push(fileData);
          this.emit('file-found', fileData);
        }
      } catch (error) {
        this.emit('find-error', { path: filePath, error });
      }
    }

    return { files: oldFiles, warnings };
  }

  // Видаляє файли зі списку
  async deleteFiles(fileList) {
    const total = fileList.length;
    let deleted = 0;
    let failed = 0;
    let freed = 0;
    let processed = 0;

    for (const file of fileList) {
      processed++;
      try {
        await fs.unlink(file.path);
        deleted++;
        freed += file.size;
        this.emit('file-deleted', { ...file, current: processed, total });
      } catch (error) {
        failed++;
        this.emit('delete-error', { path: file.path, error, current: processed, total });
      }
    }

    const result = { deleted, failed, freed };
    this.emit('cleanup-complete', result);
    return result;
  }
}
