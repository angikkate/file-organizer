# file-organizer

CLI-інструмент на Node.js для наведення порядку в директорії (наприклад, `Downloads`):
аналізує файли, шукає дублікати, сортує їх по категоріях та видаляє застарілі.

Не потребує зовнішніх залежностей — лише вбудовані модулі Node.js.

## Встановлення

Потрібен **Node.js 18 або новіший** (перевірити: `node --version`).

```bash
git clone https://github.com/angikkate/file-organizer.git
cd file-organizer
```

Встановлювати нічого не треба (`npm install` не потрібен).

## Швидкий старт

```bash
node file-organizer.js scan ~/Downloads
node file-organizer.js duplicates ~/Downloads
node file-organizer.js organize ~/Downloads --output ~/Organized
node file-organizer.js cleanup ~/Downloads --older-than 90
```

Те саме через npm scripts (зверніть увагу на `--` перед аргументами):

```bash
npm run scan -- ~/Downloads
npm run organize -- ~/Downloads --output ~/Organized
```

## Команди

### `scan` — статистика директорії

```bash
node file-organizer.js scan <directory>
```

| Аргумент | Опис |
|----------|------|
| `<directory>` | Директорія для сканування (обходяться всі піддиректорії) |

Виводить: кількість і сумарний розмір файлів, статистику по розширеннях
(топ-5 типів, решта — у `(other)`), розподіл за віком (7 / 30 / понад 90 днів),
топ-3 найбільших файли та найстаріший файл.

### `duplicates` — пошук дублікатів

```bash
node file-organizer.js duplicates <directory>
```

Рахує SHA-256 кожного файлу (через `fs.createReadStream`, тож великі файли не
завантажуються в пам'ять цілком). Файли з однаковим хешем — дублікати.
Для кожної групи показується хеш, повні шляхи копій і витрачене місце
(`розмір × (кількість копій − 1)`). Порожні файли ігноруються.

### `organize` — сортування по категоріях

```bash
node file-organizer.js organize <source> --output <target>
```

| Аргумент | Опис |
|----------|------|
| `<source>` | Директорія з файлами (оригінали **не змінюються**) |
| `--output <target>` | Куди копіювати (обов'язковий). Директорію буде створено, якщо її немає |

Категорії: `Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`
(усе невідоме потрапляє в `Other`).

- Файли **менше 10 MB** копіюються через `fs.copyFile()`.
- Файли **від 10 MB** копіюються потоком через `pipeline()`.
- Якщо файл з такою назвою вже існує, додається номер:
  `file.pdf → file(1).pdf → file(2).pdf`.

### `cleanup` — видалення старих файлів

```bash
# Dry run: лише показати, що буде видалено
node file-organizer.js cleanup <directory> --older-than 90

# Показати і справді видалити
node file-organizer.js cleanup <directory> --older-than 90 --confirm
```

| Аргумент | Опис |
|----------|------|
| `--older-than <days>` | Видаляти файли, змінені більш ніж `<days>` днів тому (обов'язковий) |
| `--confirm` | Фактично видалити файли. Без нього — лише попередній перегляд |

> ⚠️ Видалення через `--confirm` незворотне. Спочатку завжди запускайте без нього.

## Структура проєкту

```
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js     # точка входу: парсинг аргументів, вивід у консоль
└── lib/
    ├── scanner.js        # клас Scanner (scan)
    ├── duplicates.js     # клас DuplicateFinder (duplicates)
    ├── organizer.js      # клас Organizer (organize)
    ├── cleanup.js        # клас Cleanup (cleanup)
    └── utils.js          # спільні функції: formatSize, прогрес-бар, обхід директорій, помилки
```

Кожна команда — клас, що наслідує `EventEmitter`. Класи лише виконують роботу
й генерують події, а виводом у консоль (прогрес-бар, звіти) займається `file-organizer.js`.

| Клас | Події |
|------|-------|
| `Scanner` | `scan-start`, `file-found`, `file-error`, `scan-complete` |
| `DuplicateFinder` | `search-start`, `file-processed`, `file-error`, `duplicates-found` |
| `Organizer` | `organize-start`, `folders-created`, `copy-start`, `copy-complete`, `copy-error` |
| `Cleanup` | `file-found`, `find-error`, `file-deleted`, `delete-error`, `cleanup-complete` |

## Обробка помилок

Усі операції з файловою системою обгорнуті в `try...catch`.

| Код | Повідомлення |
|-----|--------------|
| `ENOENT` | Directory not found |
| `ENOTDIR` | Not a directory |
| `EACCES` / `EPERM` | Permission denied |
| `ENOSPC` | No space left on the disk |
| інші | Unexpected error + текст помилки |

Після критичної помилки програма завершується з кодом `1`.
Якщо не вдалося прочитати/скопіювати/видалити окремий файл, виводиться
попередження, а робота триває з наступним файлом.
