import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { collectFiles } from './utils.js';

export const CATEGORIES = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

const LARGE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function getCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'Other';
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Запобігає перезапису файлів з однаковими назвами
async function getUniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);

  let candidate = path.join(dir, fileName);
  let counter = 0;
  while (await exists(candidate)) {
    counter++;
    candidate = path.join(dir, `${base}(${counter})${ext}`);
  }
  return candidate;
}

async function copyFile(source, target, size) {
  if (size >= LARGE_FILE_SIZE) {
    try {
      await pipeline(createReadStream(source), createWriteStream(target));
    } catch (error) {
      await fs.unlink(target).catch(() => {});
      throw error;
    }
  } else {
    await fs.copyFile(source, target);
  }
}

export class Organizer extends EventEmitter {
  async organize(sourceDir, outputDir) {
    const outputAbs = path.resolve(outputDir);

    this.emit('organize-start', { source: sourceDir, output: outputDir });

    // Збір файлів виконується до створення вихідних папок
    const { files, warnings } = await collectFiles(sourceDir, outputAbs);
    const total = files.length;

    const folders = Object.keys(CATEGORIES);
    for (const folder of folders) {
      await fs.mkdir(path.join(outputDir, folder), { recursive: true });
    }
    this.emit('folders-created', { folders });

    const summary = new Map(folders.map((f) => [f, { count: 0, size: 0 }]));
    let copied = 0;
    let failed = 0;
    let totalSize = 0;
    let processed = 0;

    for (const filePath of files) {
      processed++;
      const category = getCategory(filePath);
      this.emit('copy-start', { path: filePath, category, current: processed, total });

      try {
        const stats = await fs.stat(filePath);
        const targetDir = path.join(outputDir, category);
        const targetPath = await getUniquePath(targetDir, path.basename(filePath));

        await copyFile(filePath, targetPath, stats.size);

        const info = summary.get(category);
        info.count++;
        info.size += stats.size;
        copied++;
        totalSize += stats.size;

        this.emit('copy-complete', {
          path: filePath,
          target: targetPath,
          category,
          size: stats.size,
          current: processed,
          total,
        });
      } catch (error) {
        failed++;
        this.emit('copy-error', { path: filePath, error, current: processed, total });
      }
    }

    return { summary, copied, failed, totalSize, warnings };
  }
}
