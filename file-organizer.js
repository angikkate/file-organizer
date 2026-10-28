import path from 'path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import {
  formatSize,
  showProgress,
  printWarnings,
  handleError,
  describeError,
} from './lib/utils.js';

const LINE = '━'.repeat(34);

function printUsage() {
  console.log(`Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <directory> --output <target-directory>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]`);
}

// Парсинг іменних прапорців (наприклад, --output /path)
function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

// ---------- scan ----------
async function runScan(directory) {
  const scanner = new Scanner();

  scanner.on('scan-start', (data) => {
    console.log(`📂 Scanning: ${data.directory}`);
  });
  scanner.on('file-found', (data) => showProgress('Processing...', data.current, data.total));
  scanner.on('file-error', (data) => {
    showProgress('Processing...', data.current, data.total);
    console.warn(`⚠️  Cannot read ${data.path}: ${describeError(data.error)}`);
  });
  scanner.on('scan-complete', (stats) => {
    printWarnings(stats.warnings);
    console.log('\n📊 Scan Results:');
    console.log(LINE);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);

    console.log('\nBy File Type:');
    const types = [...stats.byType.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [ext, info] of types.slice(0, 5)) {
      console.log(`  ${ext.padEnd(8)} ${String(info.count).padStart(4)} files   ${formatSize(info.totalSize)}`);
    }
    const rest = types.slice(5);
    if (rest.length > 0) {
      const count = rest.reduce((sum, [, i]) => sum + i.count, 0);
      const size = rest.reduce((sum, [, i]) => sum + i.totalSize, 0);
      console.log(`  ${'(other)'.padEnd(8)} ${String(count).padStart(4)} files   ${formatSize(size)}`);
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${stats.age.last7} files`);
    console.log(`  Last 30 days:   ${stats.age.last30} files`);
    console.log(`  Older than 90:  ${stats.age.older90} files`);

    console.log('\nLargest files:');
    stats.largest.forEach((file, i) => {
      console.log(`  ${i + 1}. ${path.basename(file.path)}  ${formatSize(file.size)}`);
    });

    if (stats.oldest) {
      console.log(`\nOldest file: ${path.basename(stats.oldest.path)} (modified ${stats.oldest.daysAgo} days ago)`);
    }
  });

  try {
    await scanner.scan(directory);
  } catch (error) {
    handleError(error, directory);
  }
}

// ---------- duplicates ----------
async function runDuplicates(directory) {
  const finder = new DuplicateFinder();

  finder.on('search-start', (data) => {
    console.log(`🔍 Searching for duplicates in: ${data.directory}`);
  });
  finder.on('file-processed', (data) => showProgress('Calculating hashes...', data.current, data.total));
  finder.on('file-error', (data) => {
    console.warn(`\n⚠️  Cannot read ${data.path}: ${describeError(data.error)}`);
  });
  finder.on('duplicates-found', ({ groups, totalWasted, warnings }) => {
    printWarnings(warnings);

    if (groups.length === 0) {
      console.log('\n✅ No duplicates found.');
      return;
    }

    console.log(`\nFound ${groups.length} duplicate groups (${formatSize(totalWasted)} wasted):\n`);

    groups.forEach((group, i) => {
      console.log(LINE);
      console.log(`Group ${i + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`);
      console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
      for (const p of group.paths) {
        console.log(`  📄 ${p}`);
      }
      console.log(`\n  Wasted space: ${formatSize(group.wasted)}\n`);
    });

    console.log(LINE);
    console.log(`💾 Total wasted space: ${formatSize(totalWasted)}`);
  });

  try {
    await finder.find(directory);
  } catch (error) {
    handleError(error, directory);
  }
}

// ---------- organize ----------
async function runOrganize(directory, output) {
  if (!output) {
    console.error('❌ Error: --output <target-directory> is required for organize');
    process.exit(1);
  }
  if (path.resolve(directory) === path.resolve(output)) {
    console.error('❌ Error: Source and target directories must be different');
    process.exit(1);
  }

  const organizer = new Organizer();

  organizer.on('organize-start', (data) => {
    console.log(`📦 Organizing: ${data.source}`);
    console.log(`Target: ${data.output}\n`);
    console.log('Creating folders...');
  });
  organizer.on('folders-created', ({ folders }) => {
    for (const f of folders) console.log(`  ✓ ${f}/`);
    console.log('');
  });
  organizer.on('copy-complete', (data) => showProgress('Copying files...', data.current, data.total));
  organizer.on('copy-error', (data) => {
    showProgress('Copying files...', data.current, data.total);
    console.warn(`⚠️  Failed to copy ${data.path}: ${describeError(data.error)}`);
  });

  try {
    const result = await organizer.organize(directory, output);
    printWarnings(result.warnings);

    console.log('\n✅ Organization complete!\n');
    console.log('Summary:');
    const outName = path.basename(path.resolve(output));
    for (const [category, info] of result.summary) {
      console.log(`  ${(category + ':').padEnd(11)} ${String(info.count).padStart(4)} files → ${outName}/${category}/`);
    }
    console.log(`\nTotal copied: ${result.copied} files (${formatSize(result.totalSize)})`);
    if (result.failed > 0) {
      console.log(`Failed: ${result.failed} files`);
    }
  } catch (error) {
    handleError(error, directory);
  }
}

// ---------- cleanup ----------
async function runCleanup(directory, daysValue, confirm) {
  const days = Number(daysValue);
  if (daysValue === undefined || !Number.isFinite(days) || days < 0) {
    console.error('❌ Error: --older-than <days> must be a non-negative number');
    process.exit(1);
  }

  const cleanup = new Cleanup();

  cleanup.on('find-error', (data) => {
    console.warn(`⚠️  Cannot read ${data.path}: ${describeError(data.error)}`);
  });
  cleanup.on('file-deleted', (data) => showProgress('Deleting...', data.current, data.total));
  cleanup.on('delete-error', (data) => {
    showProgress('Deleting...', data.current, data.total);
    console.warn(`⚠️  Failed to delete ${data.path}: ${describeError(data.error)}`);
  });

  console.log(`🧹 Cleanup: ${directory}`);
  console.log(`Looking for files older than ${days} days...\n`);

  try {
    const { files, warnings } = await cleanup.findOldFiles(directory, days);
    printWarnings(warnings);

    if (files.length === 0) {
      console.log('✅ No old files found.');
      return;
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const SHOW = 10;

    console.log(`Found ${files.length} files to delete:\n`);
    console.log(LINE);
    for (const file of files.slice(0, SHOW)) {
      console.log(path.basename(file.path));
      console.log(`  Path: ${file.path}`);
      console.log(`  Size: ${formatSize(file.size)}`);
      console.log(`  Modified: ${file.daysOld} days ago (${file.mtime.toISOString().slice(0, 10)})\n`);
    }
    if (files.length > SHOW) {
      console.log(`... (${files.length - SHOW} more files)`);
    }
    console.log(LINE);
    console.log(`\nTotal: ${files.length} files (${formatSize(totalSize)})\n`);

    if (!confirm) {
      console.log('⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
      return;
    }

    console.log(`⚠️  DELETING ${files.length} files (${formatSize(totalSize)}). This action cannot be undone!\n`);
    const result = await cleanup.deleteFiles(files);

    console.log('\n✅ Cleanup complete!');
    console.log(`Deleted: ${result.deleted} files (${formatSize(result.freed)} freed)`);
    if (result.failed > 0) {
      console.log(`Failed: ${result.failed} files`);
    }
  } catch (error) {
    handleError(error, directory);
  }
}

// ---------- Entry Point ----------
const [, , command, directory, ...rest] = process.argv;

if (!command || !directory || directory.startsWith('--')) {
  printUsage();
  process.exit(1);
}

switch (command) {
  case 'scan':
    await runScan(directory);
    break;
  case 'duplicates':
    await runDuplicates(directory);
    break;
  case 'organize':
    await runOrganize(directory, getOption(rest, '--output'));
    break;
  case 'cleanup':
    await runCleanup(directory, getOption(rest, '--older-than'), rest.includes('--confirm'));
    break;
  default:
    console.error(`❌ Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
