import fs from 'fs/promises';
import path from 'path';

export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total === 0 ? 0 : current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

export function showProgress(label, current, total) {
  process.stdout.write(`\r${label} ${drawProgressBar(current, total)}`);
  if (current >= total) {
    process.stdout.write('\n');
  }
}

// Рекурсивний обхід директорії (пропускає excludeDir та збирає warnings для закритих папок)
export async function collectFiles(rootDir, excludeDir = null) {
  const files = [];
  const warnings = [];

  async function walk(dir, isRoot) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isRoot) {
        throw error;
      }
      warnings.push({ path: dir, code: error.code });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (excludeDir && path.resolve(fullPath) === excludeDir) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath, false);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir, true);
  return { files, warnings };
}

export function printWarnings(warnings) {
  for (const w of warnings) {
    console.warn(`⚠️  Skipped (${w.code}): ${w.path}`);
  }
}

// Фатальні помилки (зупиняють процес)
export function handleError(error, target) {
  switch (error.code) {
    case 'ENOENT':
      console.error(`❌ Error: Directory not found: ${target}`);
      break;
    case 'ENOTDIR':
      console.error(`❌ Error: Not a directory: ${target}`);
      break;
    case 'EACCES':
    case 'EPERM':
      console.error(`❌ Error: Permission denied: ${target}`);
      break;
    case 'ENOSPC':
      console.error('❌ Error: No space left on the disk');
      break;
    default:
      console.error(`❌ Unexpected error: ${error.message}`);
  }
  process.exit(1);
}

// Помилки окремих файлів (для виводу поруч із файлом)
export function describeError(error) {
  switch (error.code) {
    case 'ENOENT':
      return 'file not found';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'ENOSPC':
      return 'no space left on the disk';
    default:
      return error.message;
  }
}
