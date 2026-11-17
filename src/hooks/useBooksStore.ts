import { useState, useEffect, useCallback, useRef } from 'react';
import { Book, BookStatus, StoreSettings } from '../types';
import { INITIAL_BOOKS, DEFAULT_STORE_SETTINGS } from '../data/initialData';
import { BcvRates, getStoredBcvRates, syncBcvRates } from '../services/bcvRates';
import { FALLBACK_BOOK_COVER } from '../utils/helpers';
import { idbGet, idbSet } from '../utils/indexedDb';
import {
  subscribeToBooks,
  subscribeToSettings,
  subscribeToCatalogs,
  saveBookToFirestore,
  deleteBookFromFirestore,
  updateBookStatusInFirestore,
  toggleBookFeaturedInFirestore,
  saveSettingsToFirestore,
  saveCatalogsToFirestore,
  seedFirestoreIfEmpty,
  isQuotaExceededError,
} from '../services/firebase';

const BOOKS_STORAGE_KEY = 'books_em_catalog_v1';
const SETTINGS_STORAGE_KEY = 'books_em_settings_v1';
const WISHLIST_STORAGE_KEY = 'books_em_wishlist_v1';
const ADMIN_SESSION_KEY = 'books_em_admin_session_v1';
const CATALOGS_STORAGE_KEY = 'books_em_catalogs_v1';

export const DEFAULT_CATALOGS: string[] = [
  'Fantasía y Aventura',
  'Desarrollo Personal',
  'Thriller y Suspenso',
  'Ciencia Ficción',
  'Clásicos y Filosofía',
  'Romance Juvenil',
  'Accesorios literarios',
];

/**
 * Merges incoming books with existing books while strictly preserving loaded images.
 * IMMUTABLE RULE: Code modifications and data synchronizations MUST NEVER delete or wipe out loaded book photos.
 */
export function mergeBooksProtectingImages(existingList: Book[], incomingList: Book[]): Book[] {
  if (!Array.isArray(incomingList) || incomingList.length === 0) {
    return existingList;
  }
  const existingMap = new Map<string, Book>();
  for (const b of existingList) {
    if (b && b.id) existingMap.set(b.id, b);
  }

  return incomingList.map((incoming) => {
    const existing = existingMap.get(incoming.id);
    if (!existing) return incoming;

    // Preserve existing images if incoming payload somehow has empty images or blank cover
    const existingImages = (Array.isArray(existing.images) && existing.images.length > 0)
      ? existing.images.filter(Boolean)
      : (existing.coverUrl ? [existing.coverUrl] : []);

    const incomingImages = (Array.isArray(incoming.images) && incoming.images.length > 0)
      ? incoming.images.filter(Boolean)
      : (incoming.coverUrl ? [incoming.coverUrl] : []);

    const protectedImages = incomingImages.length > 0 ? incomingImages : existingImages;
    const protectedCover = incoming.coverUrl || protectedImages[0] || existing.coverUrl || FALLBACK_BOOK_COVER;

    return {
      ...existing,
      ...incoming,
      coverUrl: protectedCover,
      images: protectedImages.length > 0 ? protectedImages : [protectedCover],
    };
  });
}

/**
 * Persists data to both localStorage and IndexedDB.
 * STRICT SAFEGUARD: Never strips or erases loaded book images under any circumstances.
 */
function safeSaveToLocalStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[Storage] localStorage quota reached for key "${key}", backed up to IndexedDB:`, err);
  }
  // Dual-tier non-volatile storage: IndexedDB has no 5MB limit and persists permanently
  idbSet(key, value).catch(() => {});
}

export function useBooksStore() {
  const [bcvRates, setBcvRates] = useState<BcvRates>(getStoredBcvRates);

  useEffect(() => {
    let isMounted = true;
    syncBcvRates().then((rates) => {
      if (isMounted) setBcvRates(rates);
    }).catch((err) => {
      console.warn('Initial BCV rates sync failed:', err);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize books from localStorage for immediate 0ms render
  const [books, setBooks] = useState<Book[]>(() => {
    try {
      const saved = localStorage.getItem(BOOKS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((b: Book) => {
            const cur = b.currency || 'USD';
            let imgs = Array.isArray(b.images) && b.images.length > 0 ? b.images.filter(Boolean) : [];
            if (imgs.length === 0 && b.coverUrl) {
              imgs = [b.coverUrl];
            }
            const primaryCover = imgs[0] || b.coverUrl || FALLBACK_BOOK_COVER;
            return {
              ...b,
              currency: cur,
              price: Number(b.price) || 0,
              coverUrl: primaryCover,
              images: imgs.length > 0 ? imgs : [primaryCover],
            };
          });
        }
      }
    } catch (e) {
      console.error('Error reading books from localStorage:', e);
    }
    return INITIAL_BOOKS;
  });

  const [settings, setSettings] = useState<StoreSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.adminUsername) {
          parsed.adminUsername = DEFAULT_STORE_SETTINGS.adminUsername;
        }
        if (!parsed.adminPassword) {
          parsed.adminPassword = DEFAULT_STORE_SETTINGS.adminPassword;
        }
        return { ...DEFAULT_STORE_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.error('Error reading settings from localStorage:', e);
    }
    return DEFAULT_STORE_SETTINGS;
  });

  const [wishlistIds, setWishlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(WISHLIST_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error reading wishlist from localStorage:', e);
    }
    return [];
  });

  const [catalogs, setCatalogs] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CATALOGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((c: unknown) => String(c).trim()).filter(Boolean);
        }
      }
    } catch (e) {
      console.error('Error reading catalogs from localStorage:', e);
    }
    return DEFAULT_CATALOGS;
  });

  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ADMIN_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [isWishlistOpen, setIsWishlistOpen] = useState<boolean>(false);

  // Sync to localStorage safely without exceeding quota limits
  useEffect(() => {
    safeSaveToLocalStorage(BOOKS_STORAGE_KEY, books);
  }, [books]);

  useEffect(() => {
    safeSaveToLocalStorage(SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  useEffect(() => {
    safeSaveToLocalStorage(WISHLIST_STORAGE_KEY, wishlistIds);
  }, [wishlistIds]);

  useEffect(() => {
    safeSaveToLocalStorage(CATALOGS_STORAGE_KEY, catalogs);
  }, [catalogs]);

  useEffect(() => {
    try {
      if (isAdminLoggedIn) {
        localStorage.setItem(ADMIN_SESSION_KEY, 'true');
      } else {
        localStorage.removeItem(ADMIN_SESSION_KEY);
      }
    } catch {
      // ignore
    }
  }, [isAdminLoggedIn]);

  // Handle URL hash '#admin' for quick route access
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#admin' || window.location.pathname.endsWith('/admin')) {
        setIsAdminOpen(true);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Server API Sync Functions
  const isSyncingRef = useRef(false);

  // 0. Immediate client-side IndexedDB hydration for lightning 0ms initial paint with all images
  useEffect(() => {
    let isMounted = true;
    idbGet<Book[]>(BOOKS_STORAGE_KEY).then((cachedBooks) => {
      if (isMounted && Array.isArray(cachedBooks) && cachedBooks.length > 0) {
        setBooks((current) => mergeBooksProtectingImages(current, cachedBooks));
      }
    }).catch(() => {});

    idbGet<StoreSettings>(SETTINGS_STORAGE_KEY).then((cachedSettings) => {
      if (isMounted && cachedSettings && cachedSettings.storeName) {
        setSettings((prev) => ({ ...prev, ...cachedSettings }));
      }
    }).catch(() => {});

    idbGet<string[]>(CATALOGS_STORAGE_KEY).then((cachedCatalogs) => {
      if (isMounted && Array.isArray(cachedCatalogs) && cachedCatalogs.length > 0) {
        setCatalogs(cachedCatalogs);
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const fetchServerBooks = useCallback(async () => {
    if (isSyncingRef.current) return;
    try {
      isSyncingRef.current = true;
      const res = await fetch('/api/books');
      if (res.ok) {
        const serverBooks = await res.json();
        if (Array.isArray(serverBooks) && serverBooks.length > 0) {
          setBooks((prev) => mergeBooksProtectingImages(prev, serverBooks));
        }
      }
    } catch {
      // Server not reachable or standalone client; fallback gracefully
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  const fetchServerSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const serverSettings = await res.json();
        if (serverSettings && serverSettings.storeName) {
          setSettings((prev) => ({ ...prev, ...serverSettings }));
        }
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  const fetchServerCatalogs = useCallback(async () => {
    try {
      const res = await fetch('/api/catalogs');
      if (res.ok) {
        const serverCatalogs = await res.json();
        if (Array.isArray(serverCatalogs) && serverCatalogs.length > 0) {
          setCatalogs(serverCatalogs);
        }
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  // Initial fetch and continuous real-time sync with Firebase Firestore
  const [isFirebaseConnected, setIsFirebaseConnected] = useState<boolean>(true);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(false);

  useEffect(() => {
    // 0. Active Server Sync: immediately load authoritative disk store
    fetchServerBooks();
    fetchServerSettings();
    fetchServerCatalogs();

    // Seed Firestore on startup if empty (cached flag prevents repeated queries)
    seedFirestoreIfEmpty(INITIAL_BOOKS, DEFAULT_STORE_SETTINGS, DEFAULT_CATALOGS).catch((err) => {
      console.warn('Firestore seeding check:', err);
    });

    // 1. Instant Real-time listener for all books (adds, edits, status, deletions) across all devices
    const unsubBooks = subscribeToBooks(
      (firestoreBooks) => {
        if (Array.isArray(firestoreBooks)) {
          if (firestoreBooks.length > 0) {
            setBooks((prev) => mergeBooksProtectingImages(prev, firestoreBooks));
          } else {
            seedFirestoreIfEmpty(INITIAL_BOOKS, DEFAULT_STORE_SETTINGS, DEFAULT_CATALOGS);
          }
        }
        setIsFirebaseConnected(true);
        setIsQuotaExceeded(false);
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          setIsQuotaExceeded(true);
        }
        setIsFirebaseConnected(false);
        fetchServerBooks();
      }
    );

    // 2. Instant Real-time listener for store settings (WhatsApp number, header title, etc.)
    const unsubSettings = subscribeToSettings(
      (firestoreSettings) => {
        if (firestoreSettings && firestoreSettings.storeName) {
          setSettings((prev) => ({ ...prev, ...firestoreSettings }));
        }
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          setIsQuotaExceeded(true);
        }
        fetchServerSettings();
      }
    );

    // 3. Instant Real-time listener for catalogs and genres
    const unsubCatalogs = subscribeToCatalogs(
      (firestoreCatalogs) => {
        if (Array.isArray(firestoreCatalogs) && firestoreCatalogs.length > 0) {
          setCatalogs(firestoreCatalogs);
        }
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          setIsQuotaExceeded(true);
        }
        fetchServerCatalogs();
      }
    );

    return () => {
      unsubBooks();
      unsubSettings();
      unsubCatalogs();
    };
  }, [fetchServerBooks, fetchServerSettings, fetchServerCatalogs]);

  // CRUD Methods with optimistic UI + Firebase Real-time + persistent server sync
  const addBook = (newBookData: Omit<Book, 'id' | 'createdAt'>): Book => {
    const rawImages = Array.isArray(newBookData.images) && newBookData.images.length > 0
      ? newBookData.images.filter(Boolean)
      : (newBookData.coverUrl ? [newBookData.coverUrl] : []);
    const coverUrl = rawImages[0] || newBookData.coverUrl || '';

    const newBook: Book = {
      ...newBookData,
      id: `book-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      coverUrl,
      images: rawImages.length > 0 ? rawImages : (coverUrl ? [coverUrl] : []),
      price: Number(newBookData.price) || 0,
      currency: newBookData.currency || 'USD',
      status: newBookData.status || 'disponible',
      featured: Boolean(newBookData.featured),
      editorial: newBookData.editorial || '',
      pages: newBookData.pages ? Number(newBookData.pages) : undefined,
      publishedYear: newBookData.publishedYear ? Number(newBookData.publishedYear) : undefined,
      isbn: newBookData.isbn || '',
    };

    // Optimistic UI update
    setBooks((prev) => [newBook, ...prev.filter((b) => b.id !== newBook.id)]);

    // Real-time Firebase Firestore broadcast to all connected visitors and devices
    saveBookToFirestore(newBook)
      .then(() => {
        console.log(`[useBooksStore] Libro ${newBook.id} guardado y transmitido en tiempo real por Firebase.`);
      })
      .catch((err) => {
        console.error('Firebase save book error:', err);
      });

    // Dual-layer server sync in background
    fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBook),
    }).catch(() => {});

    return newBook;
  };

  const updateBook = (updated: Book): Book => {
    const existingBook = books.find((b) => b.id === updated.id);
    const existingImages = (Array.isArray(existingBook?.images) && existingBook.images.length > 0)
      ? existingBook.images.filter(Boolean)
      : (existingBook?.coverUrl ? [existingBook.coverUrl] : []);

    const incomingImages = Array.isArray(updated.images) && updated.images.length > 0
      ? updated.images.filter(Boolean)
      : (updated.coverUrl ? [updated.coverUrl] : []);

    // IMMUTABLE IMAGE PRESERVATION:
    // If updated payload has empty images or blank cover, STRICTLY preserve the existing book photos!
    const finalImages = incomingImages.length > 0 ? incomingImages : existingImages;
    const coverUrl = finalImages[0] || updated.coverUrl || existingBook?.coverUrl || '';

    const sanitizedBook: Book = {
      ...(existingBook || {}),
      ...updated,
      coverUrl,
      images: finalImages.length > 0 ? finalImages : (coverUrl ? [coverUrl] : []),
      price: Number(updated.price) || 0,
      currency: updated.currency || 'USD',
      status: updated.status || 'disponible',
      featured: Boolean(updated.featured),
      editorial: updated.editorial !== undefined ? updated.editorial : (existingBook?.editorial || ''),
      pages: updated.pages !== undefined ? (Number(updated.pages) || undefined) : existingBook?.pages,
      publishedYear: updated.publishedYear !== undefined ? (Number(updated.publishedYear) || undefined) : existingBook?.publishedYear,
      isbn: updated.isbn !== undefined ? updated.isbn : (existingBook?.isbn || ''),
    };

    // Optimistic UI update
    setBooks((prev) => prev.map((b) => (b.id === sanitizedBook.id ? sanitizedBook : b)));
    if (selectedBook?.id === sanitizedBook.id) {
      setSelectedBook(sanitizedBook);
    }

    // Real-time Firebase Firestore broadcast
    saveBookToFirestore(sanitizedBook)
      .then(() => {
        console.log(`[useBooksStore] Libro ${sanitizedBook.id} actualizado y transmitido en tiempo real.`);
      })
      .catch((err) => {
        console.error('Firebase update book error:', err);
      });

    // Dual-layer server sync
    fetch(`/api/books/${encodeURIComponent(sanitizedBook.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitizedBook),
    }).catch(() => {});

    return sanitizedBook;
  };

  const deleteBook = (id: string) => {
    // Optimistic UI update
    setBooks((prev) => prev.filter((b) => b.id !== id));
    setWishlistIds((prev) => prev.filter((wId) => wId !== id));
    if (selectedBook?.id === id) {
      setSelectedBook(null);
    }

    // Real-time Firebase Firestore broadcast
    deleteBookFromFirestore(id).catch((err) => {
      console.warn('Firebase delete book error:', err);
    });

    // Dual-layer server sync
    fetch(`/api/books/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch((err) => {
      console.warn('Error syncing delete to server:', err);
    });
  };

  const toggleFeatured = (id: string) => {
    const currentBook = books.find((b) => b.id === id);
    const newFeatured = currentBook ? !currentBook.featured : true;

    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, featured: !b.featured } : b))
    );

    // Real-time Firebase Firestore broadcast
    toggleBookFeaturedInFirestore(id, newFeatured).catch((err) => {
      console.warn('Firebase toggle featured error:', err);
    });

    fetch(`/api/books/${encodeURIComponent(id)}/featured`, {
      method: 'PATCH',
    }).catch((err) => {
      console.warn('Error syncing featured toggle to server:', err);
    });
  };

  const updateBookStatus = (id: string, status: BookStatus) => {
    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status } : b))
    );

    // Real-time Firebase Firestore broadcast
    updateBookStatusInFirestore(id, status).catch((err) => {
      console.warn('Firebase status update error:', err);
    });

    fetch(`/api/books/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch((err) => {
      console.warn('Error syncing status update to server:', err);
    });
  };

  const updateSettings = (newFields: Partial<StoreSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...newFields };
      // Real-time Firebase Firestore broadcast
      saveSettingsToFirestore(merged).catch((err) => {
        console.warn('Firebase settings update error:', err);
      });
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      }).catch((err) => {
        console.warn('Error syncing settings to server:', err);
      });
      return merged;
    });
  };

  const resetToDefaults = () => {
    setBooks(INITIAL_BOOKS);
    setSettings(DEFAULT_STORE_SETTINGS);
    setWishlistIds([]);
    setCatalogs(DEFAULT_CATALOGS);
    localStorage.removeItem(BOOKS_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(WISHLIST_STORAGE_KEY);
    localStorage.removeItem(CATALOGS_STORAGE_KEY);

    // Broadcast reset to Firestore
    seedFirestoreIfEmpty(INITIAL_BOOKS, DEFAULT_STORE_SETTINGS, DEFAULT_CATALOGS).catch(() => {});
    saveSettingsToFirestore(DEFAULT_STORE_SETTINGS).catch(() => {});
    saveCatalogsToFirestore(DEFAULT_CATALOGS).catch(() => {});

    fetch('/api/reset', { method: 'POST' }).catch((err) => {
      console.warn('Error resetting on server:', err);
    });
  };

  const addCatalog = (name: string): { success: boolean; error?: string } => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, error: 'El nombre del catálogo no puede estar vacío.' };
    }
    if (catalogs.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      return { success: false, error: 'Ya existe un catálogo con este nombre.' };
    }
    const updated = [...catalogs, trimmed];
    setCatalogs(updated);

    // Real-time Firebase Firestore broadcast
    saveCatalogsToFirestore(updated).catch((err) => {
      console.warn('Firebase catalogs update error:', err);
    });

    fetch('/api/catalogs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogs: updated }),
    }).catch((err) => {
      console.warn('Error syncing catalogs to server:', err);
    });

    return { success: true };
  };

  const updateCatalog = (
    oldName: string,
    newName: string,
    updateBooks = true
  ): { success: boolean; error?: string } => {
    const trimmedNew = newName.trim();
    if (!trimmedNew) {
      return { success: false, error: 'El nombre del catálogo no puede estar vacío.' };
    }
    if (
      oldName.toLowerCase() !== trimmedNew.toLowerCase() &&
      catalogs.some((c) => c.toLowerCase() === trimmedNew.toLowerCase())
    ) {
      return { success: false, error: 'Ya existe otro catálogo con este nombre.' };
    }

    const updatedCatalogs = catalogs.map((c) => (c === oldName ? trimmedNew : c));
    setCatalogs(updatedCatalogs);

    // Real-time Firebase Firestore broadcast
    saveCatalogsToFirestore(updatedCatalogs).catch((err) => {
      console.warn('Firebase update catalog error:', err);
    });

    fetch('/api/catalogs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogs: updatedCatalogs }),
    }).catch((err) => {
      console.warn('Error syncing catalogs to server:', err);
    });

    if (updateBooks) {
      setBooks((prevBooks) => {
        const updated = prevBooks.map((b) =>
          b.genre?.trim().toLowerCase() === oldName.trim().toLowerCase()
            ? { ...b, genre: trimmedNew }
            : b
        );
        return updated;
      });
    }
    return { success: true };
  };

  const deleteCatalog = (
    nameToDelete: string,
    reassignTo?: string
  ): { success: boolean } => {
    const updated = catalogs.filter((c) => c !== nameToDelete);
    setCatalogs(updated);

    // Real-time Firebase Firestore broadcast
    saveCatalogsToFirestore(updated).catch((err) => {
      console.warn('Firebase delete catalog error:', err);
    });

    fetch('/api/catalogs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogs: updated }),
    }).catch((err) => {
      console.warn('Error syncing catalogs to server:', err);
    });

    if (reassignTo) {
      const target = reassignTo.trim();
      setBooks((prevBooks) =>
        prevBooks.map((b) =>
          b.genre?.trim().toLowerCase() === nameToDelete.trim().toLowerCase()
            ? { ...b, genre: target }
            : b
        )
      );
    }
    return { success: true };
  };

  const reorderCatalogs = (newOrder: string[]) => {
    setCatalogs(newOrder);
    saveCatalogsToFirestore(newOrder).catch((err) => {
      console.warn('Firebase reorder catalogs error:', err);
    });
    fetch('/api/catalogs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogs: newOrder }),
    }).catch((err) => {
      console.warn('Error syncing catalogs to server:', err);
    });
  };

  const resetCatalogs = () => {
    setCatalogs(DEFAULT_CATALOGS);
    saveCatalogsToFirestore(DEFAULT_CATALOGS).catch((err) => {
      console.warn('Firebase reset catalogs error:', err);
    });
    fetch('/api/catalogs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogs: DEFAULT_CATALOGS }),
    }).catch((err) => {
      console.warn('Error syncing catalogs to server:', err);
    });
  };

  const importCatalog = (importedBooks: Book[]) => {
    if (Array.isArray(importedBooks) && importedBooks.length > 0) {
      setBooks(importedBooks);
      safeSaveToLocalStorage(BOOKS_STORAGE_KEY, importedBooks);
      // Sync each or bulk to server
      importedBooks.forEach((book) => {
        fetch(`/api/books/${encodeURIComponent(book.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(book),
        }).catch(() => {});
      });
    }
  };

  const toggleWishlist = (bookId: string) => {
    setWishlistIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  };

  const loginAdmin = (username: string, password: string): boolean => {
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();
    const expectedUser = (settings.adminUsername || DEFAULT_STORE_SETTINGS.adminUsername || '').trim().toLowerCase();
    const expectedPass = (settings.adminPassword || DEFAULT_STORE_SETTINGS.adminPassword || '').trim();

    const isUserValid = cleanUser === expectedUser;
    const isPassValid = cleanPass === expectedPass;

    if (isUserValid && isPassValid) {
      setIsAdminLoggedIn(true);
      setIsAdminOpen(true);
      return true;
    }
    return false;
  };

  const logoutAdmin = () => {
    setIsAdminLoggedIn(false);
    setIsAdminOpen(false);
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const updateBcvRates = (newRates: BcvRates) => {
    setBcvRates(newRates);
    try {
      localStorage.setItem('books_em_bcv_rates', JSON.stringify(newRates));
    } catch (e) {
      console.warn('Error saving custom BCV rates:', e);
    }
  };

  return {
    books,
    settings,
    bcvRates,
    isFirebaseConnected,
    isQuotaExceeded,
    quotaUpgradeUrl: 'https://console.firebase.google.com/project/gen-lang-client-0577752550/firestore/databases/ai-studio-booksem-8d96eb7e-6b7d-4ce4-bccf-d684b910b08c/data?openUpgradeDialog=true',
    refreshBcvRates: () => syncBcvRates(true).then((rates) => {
      setBcvRates(rates);
      return rates;
    }),
    updateBcvRates,
    wishlistIds,
    isAdminOpen,
    isAdminLoggedIn,
    selectedBook,
    isWishlistOpen,
    setIsAdminOpen,
    setSelectedBook,
    setIsWishlistOpen,
    addBook,
    updateBook,
    deleteBook,
    toggleFeatured,
    updateBookStatus,
    updateSettings,
    resetToDefaults,
    importCatalog,
    toggleWishlist,
    catalogs,
    addCatalog,
    updateCatalog,
    deleteCatalog,
    reorderCatalogs,
    resetCatalogs,
    loginAdmin,
    logoutAdmin,
  };
}
