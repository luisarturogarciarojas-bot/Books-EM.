import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  updateDoc,
  getDocs,
  writeBatch,
  Unsubscribe,
  Firestore,
} from 'firebase/firestore';
import { Book, BookStatus, StoreSettings } from '../types';
import rawConfig from '../../firebase-applet-config.json';
import { FALLBACK_BOOK_COVER } from '../utils/helpers';

export const firebaseConfig = rawConfig;

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Firestore with the provisioned named database
export const db: Firestore = getFirestore(
  app,
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined
);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === 'resource-exhausted' ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('resource-exhausted') ||
    msg.toLowerCase().includes('daily read units') ||
    msg.toLowerCase().includes('free daily read units')
  );
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser ? auth.currentUser.isAnonymous : true,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };
  if (isQuotaExceededError(error)) {
    console.warn('[Firestore Quota Notice] Operación afectada por el límite diario de consultas de Firestore (modo offline/servidor activo):', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Deeply sanitizes an object for Firestore by omitting any fields with `undefined` values.
 * Firestore strictly rejects documents containing `undefined` properties.
 */
export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeForFirestore(value);
    } else if (Array.isArray(value)) {
      clean[key] = value.filter((item) => item !== undefined);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const BOOKS_COLLECTION = 'books';
const SETTINGS_DOC_ID = 'store_settings';
const CATALOGS_DOC_ID = 'catalog_genres';

/**
 * Subscribe to real-time updates for books catalog.
 * Any admin change (add, edit, status change, delete, toggle featured)
 * triggers instant notification to all active clients across all devices.
 */
export function subscribeToBooks(
  onUpdate: (books: Book[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const booksRef = collection(db, BOOKS_COLLECTION);
  return onSnapshot(
    booksRef,
    (snapshot) => {
      const booksList: Book[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const primaryImages = Array.isArray(data.images) && data.images.length > 0
          ? data.images.filter(Boolean)
          : (data.coverUrl ? [data.coverUrl] : []);
        const primaryCover = primaryImages[0] || data.coverUrl || FALLBACK_BOOK_COVER;

        booksList.push({
          id: docSnap.id,
          title: data.title || 'Sin Título',
          author: data.author || 'Autor Desconocido',
          genre: data.genre || 'General',
          price: Number(data.price) || 0,
          currency: data.currency || 'USD',
          status: data.status || 'disponible',
          featured: Boolean(data.featured),
          coverUrl: primaryCover,
          images: primaryImages.length > 0 ? primaryImages : [primaryCover],
          synopsis: data.synopsis || '',
          editorial: data.editorial || '',
          pages: data.pages ? Number(data.pages) : undefined,
          publishedYear: data.publishedYear ? Number(data.publishedYear) : undefined,
          isbn: data.isbn || '',
          createdAt: Number(data.createdAt) || Date.now(),
        });
      });

      // Sort by creation date descending (newest publications first)
      booksList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onUpdate(booksList);
    },
    (err) => {
      if (isQuotaExceededError(err)) {
        console.warn('Firebase Books listener: Límite de cuota gratuita alcanzado en Firestore. El catálogo opera de forma continua mediante almacenamiento local y servidor Express.');
      } else {
        console.warn('Firebase Books listener notice (activando respaldo local):', err instanceof Error ? err.message : err);
      }
      onError?.(err);
    }
  );
}

/**
 * Subscribe to store settings in real-time.
 */
export function subscribeToSettings(
  onUpdate: (settings: StoreSettings) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const settingsDocRef = doc(db, 'settings', SETTINGS_DOC_ID);
  return onSnapshot(
    settingsDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        onUpdate(data);
      }
    },
    (err) => {
      if (isQuotaExceededError(err)) {
        console.warn('Firebase Settings listener: Límite de cuota gratuita alcanzado en Firestore. Respaldando configuración desde almacenamiento local y servidor Express.');
      } else {
        console.warn('Firebase Settings listener notice (activando respaldo local):', err instanceof Error ? err.message : err);
      }
      onError?.(err);
    }
  );
}

/**
 * Subscribe to catalogs / genres in real-time.
 */
export function subscribeToCatalogs(
  onUpdate: (catalogs: string[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const catalogsDocRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
  return onSnapshot(
    catalogsDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (Array.isArray(data.items)) {
          onUpdate(data.items);
        }
      }
    },
    (err) => {
      if (isQuotaExceededError(err)) {
        console.warn('Firebase Catalogs listener: Límite de cuota gratuita alcanzado en Firestore. Respaldando catálogos desde almacenamiento local y servidor Express.');
      } else {
        console.warn('Firebase Catalogs listener notice (activando respaldo local):', err instanceof Error ? err.message : err);
      }
      onError?.(err);
    }
  );
}

/**
 * Save or update a book in Firestore.
 * Automatically sanitizes properties to prevent undefined values.
 */
export async function saveBookToFirestore(book: Book): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, book.id);
  const rawImages = Array.isArray(book.images) && book.images.length > 0
    ? book.images.filter(Boolean)
    : (book.coverUrl ? [book.coverUrl] : []);
  const coverUrl = rawImages[0] || book.coverUrl || FALLBACK_BOOK_COVER;

  const dataToSave = sanitizeForFirestore({
    ...book,
    coverUrl,
    images: rawImages.length > 0 ? rawImages : [coverUrl],
    price: Number(book.price) || 0,
    updatedAt: Date.now(),
  });

  try {
    await setDoc(docRef, dataToSave, { merge: true });
    console.log(`[Firestore] Publicación «${book.title}» sincronizada en tiempo real con éxito.`);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(`[Firestore Quota] No se pudo escribir «${book.title}» en Firestore por límite de cuota diaria. Guardado en servidor Express y almacenamiento local.`);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `books/${book.id}`);
  }
}

/**
 * Delete a book from Firestore.
 */
export async function deleteBookFromFirestore(bookId: string): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  try {
    await deleteDoc(docRef);
    console.log(`[Firestore] Publicación «${bookId}» eliminada en tiempo real.`);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(`[Firestore Quota] No se pudo borrar «${bookId}» en Firestore por límite de cuota diaria. Eliminado de servidor Express y almacenamiento local.`);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `books/${bookId}`);
  }
}

/**
 * Update a book status in Firestore.
 */
export async function updateBookStatusInFirestore(bookId: string, status: BookStatus): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  try {
    await updateDoc(docRef, {
      status,
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(`[Firestore Quota] No se pudo actualizar estado de «${bookId}» en Firestore por límite de cuota.`);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `books/${bookId}`);
  }
}

/**
 * Toggle book featured status in Firestore.
 */
export async function toggleBookFeaturedInFirestore(bookId: string, featured: boolean): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  try {
    await updateDoc(docRef, {
      featured,
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(`[Firestore Quota] No se pudo actualizar destacado de «${bookId}» en Firestore por límite de cuota.`);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `books/${bookId}`);
  }
}

/**
 * Save store settings in Firestore.
 */
export async function saveSettingsToFirestore(settings: StoreSettings): Promise<void> {
  const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
  const dataToSave = sanitizeForFirestore({ ...settings, updatedAt: Date.now() });
  try {
    await setDoc(docRef, dataToSave, { merge: true });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn('[Firestore Quota] Configuración de tienda guardada localmente y en servidor Express (límite de cuota Firestore alcanzado).');
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `settings/${SETTINGS_DOC_ID}`);
  }
}

/**
 * Save catalogs list in Firestore.
 */
export async function saveCatalogsToFirestore(catalogs: string[]): Promise<void> {
  const docRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
  const cleanList = Array.isArray(catalogs) ? catalogs.filter(Boolean) : [];
  try {
    await setDoc(docRef, { items: cleanList, updatedAt: Date.now() }, { merge: true });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn('[Firestore Quota] Lista de catálogos guardada localmente y en servidor Express (límite de cuota Firestore alcanzado).');
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, `catalogs/${CATALOGS_DOC_ID}`);
  }
}

/**
 * Initial Seeding: if Firestore collections are empty, populate them with the initial catalogue.
 * Uses localStorage cache flag to avoid repeating queries on every single browser reload.
 */
export async function seedFirestoreIfEmpty(
  initialBooks: Book[],
  initialSettings: StoreSettings,
  initialCatalogs: string[]
): Promise<void> {
  try {
    if (typeof window !== 'undefined' && localStorage.getItem('books_em_firestore_seeded_v1')) {
      return;
    }

    const booksRef = collection(db, BOOKS_COLLECTION);
    const snap = await getDocs(booksRef);

    if (snap.empty && initialBooks.length > 0) {
      console.log('Poblando catálogo inicial en Firestore...');
      const batch = writeBatch(db);
      for (const book of initialBooks) {
        const bookDoc = doc(db, BOOKS_COLLECTION, book.id);
        const cleanBook = sanitizeForFirestore({ ...book, createdAt: book.createdAt || Date.now() });
        batch.set(bookDoc, cleanBook);
      }
      await batch.commit();
      console.log('Catálogo inicial poblado en Firestore exitosamente.');
    }

    // Seed settings if missing
    const settingsDocRef = doc(db, 'settings', SETTINGS_DOC_ID);
    const settingsSnap = await getDocs(collection(db, 'settings'));
    if (settingsSnap.empty) {
      await setDoc(settingsDocRef, sanitizeForFirestore({ ...initialSettings, updatedAt: Date.now() }));
    }

    // Seed catalogs if missing
    const catalogsSnap = await getDocs(collection(db, 'catalogs'));
    if (catalogsSnap.empty) {
      const catalogsDocRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
      await setDoc(catalogsDocRef, { items: initialCatalogs, updatedAt: Date.now() });
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('books_em_firestore_seeded_v1', 'true');
    }
  } catch (err) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('books_em_firestore_seeded_v1', 'true');
    }
    if (isQuotaExceededError(err)) {
      console.warn('Firestore seeding check: cuota gratuita diaria de Firestore alcanzada; usando catálogo del servidor Express y local.');
    } else {
      console.warn('Firestore seeding check skipped or failed:', err);
    }
  }
}
