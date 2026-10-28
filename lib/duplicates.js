import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { collectFiles } from './utils.js';

export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    this.emit('search-start', { directory });

    const { files, warnings } = await collectFiles(directory);
    const total = files.length;

    const hashMap = new Map(); // hash -> { size, paths: [] }
    let processed = 0;

    for (const filePath of files) {
      processed++;
      try {
        const stats = await fsp.stat(filePath);

        if (stats.size > 0) {
          const hash = await calculateHash(filePath);
          const group = hashMap.get(hash) || { size: stats.size, paths: [] };
          group.paths.push(filePath);
          hashMap.set(hash, group);
        }
      } catch (error) {
        this.emit('file-error', { path: filePath, error });
      }
      this.emit('file-processed', { path: filePath, current: processed, total });
    }

    const groups = [];
    for (const [hash, group] of hashMap) {
      if (group.paths.length > 1) {
        const wasted = group.size * (group.paths.length - 1);
        groups.push({ hash, size: group.size, paths: group.paths, wasted });
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);

    const totalWasted = groups.reduce((sum, g) => sum + g.wasted, 0);
    const result = { groups, totalWasted, warnings };

    this.emit('duplicates-found', result);
    return result;
  }
}
