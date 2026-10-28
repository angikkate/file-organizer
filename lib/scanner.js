import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFiles } from './utils.js';

const DAY = 1000 * 60 * 60 * 24;

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const { files, warnings } = await collectFiles(directory);
    const total = files.length;

    const byType = new Map(); // extension -> { count, totalSize }
    const age = { last7: 0, last30: 0, older90: 0 };
    const scanned = [];
    let totalSize = 0;
    let processed = 0;
    const now = Date.now();

    for (const filePath of files) {
      processed++;
      try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase() || '(no ext)';

        totalSize += stats.size;

        const typeInfo = byType.get(ext) || { count: 0, totalSize: 0 };
        typeInfo.count++;
        typeInfo.totalSize += stats.size;
        byType.set(ext, typeInfo);

        const daysOld = (now - stats.mtime.getTime()) / DAY;
        if (daysOld <= 7) age.last7++;
        if (daysOld <= 30) age.last30++;
        if (daysOld > 90) age.older90++;

        const fileData = { path: filePath, size: stats.size, mtime: stats.mtime };
        scanned.push(fileData);
        this.emit('file-found', { ...fileData, current: processed, total });
      } catch (error) {
        this.emit('file-error', { path: filePath, error, current: processed, total });
      }
    }

    const largest = [...scanned].sort((a, b) => b.size - a.size).slice(0, 3);

    let oldest = null;
    for (const file of scanned) {
      if (!oldest || file.mtime < oldest.mtime) {
        oldest = file;
      }
    }
    if (oldest) {
      oldest = { ...oldest, daysAgo: Math.floor((now - oldest.mtime.getTime()) / DAY) };
    }

    const statistics = {
      totalFiles: scanned.length,
      totalSize,
      byType,
      age,
      largest,
      oldest,
      warnings,
    };

    this.emit('scan-complete', statistics);
    return statistics;
  }
}
