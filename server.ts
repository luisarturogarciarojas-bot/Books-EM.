process.env.DISABLE_HMR = 'true';

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { INITIAL_BOOKS, DEFAULT_STORE_SETTINGS } from './src/data/initialData';
import { DEFAULT_CATALOGS } from './src/hooks/useBooksStore';
import { Book, StoreSettings } from './src/types';

const PORT = 3000;
const DATA_DIR = path.join(process.cwd(), 'data');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CATALOGS_FILE = path.join(DATA_DIR, 'catalogs.json');
const PUBLIC_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const ROOT_UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure data and uploads directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) {
  fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(ROOT_UPLOADS_DIR)) {
  fs.mkdirSync(ROOT_UPLOADS_DIR, { recursive: true });
}

// Helper to save base64 Data URL to public uploads file
function saveBase64Image(dataUrl: string, prefix = 'book'): string {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  // If it is already an HTTP URL or local static URL, keep it
  if (!dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches) return dataUrl;

    let ext = matches[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (ext.includes('svg')) ext = 'svg';
    if (ext.includes('png')) ext = 'png';
    if (ext.includes('webp')) ext = 'webp';

    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const filename = `${prefix}_${timestamp}_${randomSuffix}.${ext}`;

    // Write to both public/uploads (for Vite and static preview) and uploads/
    const publicPath = path.join(PUBLIC_UPLOADS_DIR, filename);
    const rootPath = path.join(ROOT_UPLOADS_DIR, filename);

    fs.writeFileSync(publicPath, buffer);
    try {
      fs.writeFileSync(rootPath, buffer);
    } catch {
      // Best-effort
    }

    return `/uploads/${filename}`;
  } catch (err) {
    console.error('Error saving base64 image to server:', err);
    return dataUrl;
  }
}

// Helper to safely read JSON file with fallback
function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

// Helper to safely write JSON file
function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Initialize files if they don't exist
if (!fs.existsSync(BOOKS_FILE)) {
  writeJsonFile(BOOKS_FILE, INITIAL_BOOKS);
}
if (!fs.existsSync(SETTINGS_FILE)) {
  writeJsonFile(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
}
if (!fs.existsSync(CATALOGS_FILE)) {
  writeJsonFile(CATALOGS_FILE, DEFAULT_CATALOGS);
}

async function startServer() {
  const app = express();

  // Allow high-res base64 images uploads for book gallery (up to 50MB)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Serve persistent uploaded image files statically for both dev and production
  app.use('/uploads', express.static(PUBLIC_UPLOADS_DIR, { maxAge: '30d' }));
  app.use('/uploads', express.static(ROOT_UPLOADS_DIR, { maxAge: '30d' }));

  // API Routes: Direct Image Upload
  app.post('/api/upload', (req: Request, res: Response) => {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'La imagen en formato base64/dataUrl es requerida' });
      return;
    }

    const cleanPrefix = filename ? filename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20) : 'foto';
    const publicUrl = saveBase64Image(dataUrl, cleanPrefix);
    res.json({ success: true, url: publicUrl });
  });

  app.post('/api/upload-batch', (req: Request, res: Response) => {
    const { images } = req.body;
    if (!Array.isArray(images)) {
      res.status(400).json({ error: 'Se esperaba un arreglo de imágenes' });
      return;
    }

    const urls = images.map((img: string, idx: number) => {
      if (!img || typeof img !== 'string') return '';
      return saveBase64Image(img, `foto_${idx + 1}`);
    }).filter(Boolean);

    res.json({ success: true, urls });
  });

  // API Routes: Health
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // API Routes: Books Catalog
  app.get('/api/books', (_req: Request, res: Response) => {
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    res.json(books);
  });

  app.post('/api/books', (req: Request, res: Response) => {
    const newBookData = req.body;
    if (!newBookData || !newBookData.title || !newBookData.author) {
      res.status(400).json({ error: 'Título y autor son obligatorios' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const rawImages = Array.isArray(newBookData.images) && newBookData.images.length > 0
      ? newBookData.images.filter(Boolean)
      : (newBookData.coverUrl ? [newBookData.coverUrl] : []);
    
    // Save any base64 images to server static uploads directory
    const images = rawImages.map((img: string) => saveBase64Image(img, 'portada'));
    const coverUrl = images[0] || saveBase64Image(newBookData.coverUrl || '', 'portada');

    const newBook: Book = {
      ...newBookData,
      id: newBookData.id || `book-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: newBookData.createdAt || Date.now(),
      coverUrl,
      images: images.length > 0 ? images : (coverUrl ? [coverUrl] : []),
      price: Number(newBookData.price) || 0,
      currency: newBookData.currency || 'USD',
      status: newBookData.status || 'disponible',
      featured: Boolean(newBookData.featured),
    };

    const updatedBooks = [newBook, ...books.filter((b) => b.id !== newBook.id)];
    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.status(201).json(newBook);
  });

  // Helper for safe book updating with field preservation and image conversion
  const handleUpdateBook = (req: Request, res: Response) => {
    const bookId = req.params.id;
    const updatedData = req.body;
    if (!updatedData) {
      res.status(400).json({ error: 'Datos del libro son obligatorios' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const existingIndex = books.findIndex((b) => b.id === bookId);
    const existingBook = existingIndex >= 0 ? books[existingIndex] : null;

    // Preserve existing images if not provided in update
    let images: string[];
    if (Array.isArray(updatedData.images) && updatedData.images.length > 0) {
      images = updatedData.images.filter(Boolean).map((img: string) => saveBase64Image(img, 'portada'));
    } else if (updatedData.coverUrl) {
      images = [saveBase64Image(updatedData.coverUrl, 'portada')];
    } else if (existingBook && Array.isArray(existingBook.images) && existingBook.images.length > 0) {
      images = existingBook.images;
    } else if (existingBook?.coverUrl) {
      images = [existingBook.coverUrl];
    } else {
      images = [];
    }

    const coverUrl = images[0] || (updatedData.coverUrl ? saveBase64Image(updatedData.coverUrl, 'portada') : existingBook?.coverUrl) || '';

    // Safe merge: Never wipe out existing fields when a partial update (like price or status) is executed
    const sanitizedBook: Book = {
      ...(existingBook || {}),
      ...updatedData,
      id: bookId,
      title: updatedData.title !== undefined ? String(updatedData.title).trim() : (existingBook?.title || 'Sin Título'),
      author: updatedData.author !== undefined ? String(updatedData.author).trim() : (existingBook?.author || 'Autor Desconocido'),
      genre: updatedData.genre !== undefined ? String(updatedData.genre).trim() : (existingBook?.genre || 'General'),
      price: updatedData.price !== undefined ? Number(updatedData.price) || 0 : (existingBook?.price ?? 0),
      currency: updatedData.currency ?? existingBook?.currency ?? 'USD',
      status: updatedData.status ?? existingBook?.status ?? 'disponible',
      featured: updatedData.featured !== undefined ? Boolean(updatedData.featured) : (existingBook?.featured ?? false),
      coverUrl,
      images: images.length > 0 ? images : (coverUrl ? [coverUrl] : []),
      synopsis: updatedData.synopsis !== undefined ? String(updatedData.synopsis).trim() : (existingBook?.synopsis || ''),
      editorial: updatedData.editorial !== undefined ? String(updatedData.editorial).trim() : existingBook?.editorial,
      pages: updatedData.pages !== undefined ? Number(updatedData.pages) || undefined : existingBook?.pages,
      publishedYear: updatedData.publishedYear !== undefined ? Number(updatedData.publishedYear) || undefined : existingBook?.publishedYear,
      isbn: updatedData.isbn !== undefined ? String(updatedData.isbn).trim() : existingBook?.isbn,
      createdAt: updatedData.createdAt || existingBook?.createdAt || Date.now(),
    };

    let updatedBooks: Book[];
    if (existingIndex >= 0) {
      updatedBooks = books.map((b) => (b.id === bookId ? sanitizedBook : b));
    } else {
      updatedBooks = [sanitizedBook, ...books];
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(sanitizedBook);
  };

  app.put('/api/books/:id', handleUpdateBook);
  app.patch('/api/books/:id', handleUpdateBook);

  app.delete('/api/books/:id', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const updatedBooks = books.filter((b) => b.id !== bookId);
    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json({ success: true, id: bookId });
  });

  app.patch('/api/books/:id/status', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: 'Estado es obligatorio' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    let targetBook: Book | null = null;
    const updatedBooks = books.map((b) => {
      if (b.id === bookId) {
        targetBook = { ...b, status };
        return targetBook;
      }
      return b;
    });

    if (!targetBook) {
      res.status(404).json({ error: 'Libro no encontrado' });
      return;
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(targetBook);
  });

  app.patch('/api/books/:id/featured', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    let targetBook: Book | null = null;
    const updatedBooks = books.map((b) => {
      if (b.id === bookId) {
        targetBook = { ...b, featured: !b.featured };
        return targetBook;
      }
      return b;
    });

    if (!targetBook) {
      res.status(404).json({ error: 'Libro no encontrado' });
      return;
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(targetBook);
  });

  // API Routes: Settings
  app.get('/api/settings', (_req: Request, res: Response) => {
    const settings = readJsonFile<StoreSettings>(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    res.json(settings);
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const newSettings = req.body;
    const currentSettings = readJsonFile<StoreSettings>(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    const merged = { ...currentSettings, ...newSettings };
    writeJsonFile(SETTINGS_FILE, merged);
    res.json(merged);
  });

  // API Routes: Catalogs / Genres
  app.get('/api/catalogs', (_req: Request, res: Response) => {
    const catalogs = readJsonFile<string[]>(CATALOGS_FILE, DEFAULT_CATALOGS);
    res.json(catalogs);
  });

  app.put('/api/catalogs', (req: Request, res: Response) => {
    const { catalogs } = req.body;
    if (Array.isArray(catalogs)) {
      writeJsonFile(CATALOGS_FILE, catalogs);
      res.json({ success: true, catalogs });
      return;
    }
    res.status(400).json({ error: 'Formato de catálogos inválido' });
  });

  // API Routes: Reset to Defaults
  app.post('/api/reset', (_req: Request, res: Response) => {
    writeJsonFile(BOOKS_FILE, INITIAL_BOOKS);
    writeJsonFile(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    writeJsonFile(CATALOGS_FILE, DEFAULT_CATALOGS);
    res.json({ success: true, books: INITIAL_BOOKS, settings: DEFAULT_STORE_SETTINGS, catalogs: DEFAULT_CATALOGS });
  });

  // Vite middleware for development vs Static files for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Books EM running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
