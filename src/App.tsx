/**
 * Books EM - Librería y Tienda de Libros Online
 * Complete, responsive, full-stack store with WhatsApp checkout, real-time client sync, and private Admin panel.
 */

import React, { useState } from 'react';
import { useBooksStore } from './hooks/useBooksStore';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { BookCatalog } from './components/BookCatalog';
import { HowToBuySection } from './components/HowToBuySection';
import { Footer } from './components/Footer';
import { BookDetailModal } from './components/BookDetailModal';
import { WishlistModal } from './components/WishlistModal';
import { AdminLoginView } from './components/admin/AdminLoginView';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { AppIntroSplash } from './components/AppIntroSplash';
import { PublicationEditorModal } from './components/admin/PublicationEditorModal';
import { MessageCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { cleanPhoneNumber, FALLBACK_BOOK_COVER } from './utils/helpers';
import { Book } from './types';
import { DEFAULT_STORE_SETTINGS } from './data/initialData';

// Code-splitting: Only load the heavy admin panel bundle when admin logs in
const AdminPanel = React.lazy(() =>
  import('./components/admin/AdminPanel').then((module) => ({
    default: module.AdminPanel,
  }))
);

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [isIntroExiting, setIsIntroExiting] = useState(false);
  const {
    books,
    settings,
    bcvRates,
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
    refreshBcvRates,
    updateBcvRates,
    catalogs,
    addCatalog,
    updateCatalog,
    deleteCatalog,
    reorderCatalogs,
    resetCatalogs,
    loginAdmin,
    logoutAdmin,
    isFirebaseConnected,
    isQuotaExceeded,
    quotaUpgradeUrl,
  } = useBooksStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [directEditBook, setDirectEditBook] = useState<Book | null>(null);
  const [storeEditingBook, setStoreEditingBook] = useState<Book | null>(null);
  const [isStoreEditModalOpen, setIsStoreEditModalOpen] = useState(false);
  const [storeToast, setStoreToast] = useState<string | null>(null);
  const [manualInstallTrigger, setManualInstallTrigger] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<'publications' | 'catalogs' | 'whatsapp' | 'store' | 'rates'>('publications');

  const showStoreToast = (msg: string) => {
    setStoreToast(msg);
    setTimeout(() => {
      setStoreToast((curr) => (curr === msg ? null : curr));
    }, 4500);
  };

  const scrollToCatalog = () => {
    const el = document.getElementById('catalog-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToHowToBuy = () => {
    const el = document.getElementById('how-to-buy-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const safeSettings = settings || DEFAULT_STORE_SETTINGS;
  const availableBooksCount = books.filter((b) => b.status === 'disponible').length;
  const cleanPhone = cleanPhoneNumber(safeSettings.whatsappNumber);
  const floatingWhatsAppUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
        `¡Hola ${safeSettings.storeName}! 👋 Tengo una consulta sobre su catálogo de libros.`
      )}`
    : '#';

  // Dedicated Fullscreen Admin Login Page (If Admin opened but not authenticated)
  if (isAdminOpen && !isAdminLoggedIn) {
    return (
      <AdminLoginView
        onLogin={loginAdmin}
        onBackToStore={() => setIsAdminOpen(false)}
        storeName={safeSettings.storeName}
      />
    );
  }

  // Dedicated Fullscreen Admin Page (When Admin is logged in and unlocked)
  if (isAdminOpen && isAdminLoggedIn) {
    return (
      <React.Suspense
        fallback={
          <div className="min-h-screen bg-[#EADBD9] flex flex-col items-center justify-center gap-3 text-[#5C3218]">
            <Loader2 className="w-8 h-8 animate-spin text-[#8C5E3C]" />
            <p className="font-serif-title text-base font-bold">Cargando Panel de Administración...</p>
          </div>
        }
      >
        <AdminPanel
          books={books}
          settings={safeSettings}
          bcvRates={bcvRates}
          onClose={() => setIsAdminOpen(false)}
          onLogout={logoutAdmin}
          onAddBook={addBook}
          onUpdateBook={updateBook}
          onDeleteBook={deleteBook}
          onToggleFeatured={toggleFeatured}
          onUpdateBookStatus={updateBookStatus}
          onUpdateSettings={updateSettings}
          onResetDefaults={resetToDefaults}
          onImportCatalog={importCatalog}
          onRefreshRates={refreshBcvRates}
          onUpdateRates={updateBcvRates}
          catalogs={catalogs}
          onAddCatalog={addCatalog}
          onUpdateCatalog={updateCatalog}
          onDeleteCatalog={deleteCatalog}
          onReorderCatalogs={reorderCatalogs}
          onResetCatalogs={resetCatalogs}
          directEditBook={directEditBook}
          onClearDirectEditBook={() => setDirectEditBook(null)}
          initialTab={adminInitialTab}
          isFirebaseConnected={isFirebaseConnected}
          isQuotaExceeded={isQuotaExceeded}
          quotaUpgradeUrl={quotaUpgradeUrl}
        />
      </React.Suspense>
    );
  }

  // Public Online Store (Customer View & Live Admin View)
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C2420] flex flex-col relative selection:bg-[#E8DCCF]">
      {/* Intro Botanical Splash animation on first load */}
      {showIntro && (
        <AppIntroSplash
          storeName={safeSettings.storeName}
          tagline={safeSettings.tagline}
          isExiting={isIntroExiting}
          onComplete={() => {
            setIsIntroExiting(true);
            setTimeout(() => setShowIntro(false), 500);
          }}
        />
      )}

      {/* Floating Success Toast for Store Actions */}
      {storeToast && (
        <div className="fixed top-5 right-5 z-60 bg-[#3B2213] text-[#FAF7F2] px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-3 border border-[#8C5E3C] animate-in fade-in slide-in-from-top-3 duration-200 max-w-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{storeToast}</span>
        </div>
      )}

      {/* Primary Header with BCV Currency Indicator & Navigation */}
      <Header
        settings={safeSettings}
        storeName={safeSettings.storeName}
        bcvRates={bcvRates}
        wishlistCount={wishlistIds.length}
        isAdminLoggedIn={isAdminLoggedIn}
        onOpenWishlist={() => setIsWishlistOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onScrollToCatalog={scrollToCatalog}
        onScrollToHowToBuy={scrollToHowToBuy}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenInstallPrompt={() => setManualInstallTrigger(true)}
        onRefreshBcvRates={refreshBcvRates}
      />

      <div className="flex-1 flex flex-col">
        {/* Hero Banner with Literary Presentation & Quick Action */}
        <HeroBanner
          settings={safeSettings}
          storeName={safeSettings.storeName}
          tagline={safeSettings.tagline}
          totalBooks={books.length}
          availableCount={availableBooksCount}
          onScrollToCatalog={scrollToCatalog}
          onExploreClick={scrollToCatalog}
          selectedGenre={selectedGenre}
          onSelectGenre={setSelectedGenre}
          catalogs={catalogs}
          isAdminLoggedIn={isAdminLoggedIn}
          onEditSelectedEditions={() => {
            setAdminInitialTab('store');
            setIsAdminOpen(true);
          }}
        />

        {/* Main Content Area */}
        <main className="flex-1">
          {/* Public Catalog with Filters, Search, and Book Cards */}
          <BookCatalog
            books={books}
            settings={safeSettings}
            wishlistIds={wishlistIds}
            bcvRates={bcvRates}
            catalogs={catalogs}
            onToggleWishlist={toggleWishlist}
            onSelectBook={(book) => setSelectedBook(book)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedGenre={selectedGenre}
            onSelectGenre={setSelectedGenre}
            isAdminLoggedIn={isAdminLoggedIn}
            onEditBook={(book) => {
              setStoreEditingBook(book);
              setIsStoreEditModalOpen(true);
            }}
          />

          {/* 3-Step WhatsApp Purchase Guide & Payment Info */}
          <HowToBuySection settings={safeSettings} />
        </main>

        {/* Footer */}
        <Footer
          settings={safeSettings}
          onOpenInstallPrompt={() => setManualInstallTrigger(true)}
        />

        {/* Book Detailed Modal */}
        {selectedBook && (
          <BookDetailModal
            book={selectedBook}
            settings={safeSettings}
            bcvRates={bcvRates}
            isWishlisted={wishlistIds.includes(selectedBook.id)}
            onToggleWishlist={toggleWishlist}
            onClose={() => setSelectedBook(null)}
            isAdminLoggedIn={isAdminLoggedIn}
            onEditInAdmin={(book) => {
              setSelectedBook(null);
              setStoreEditingBook(book);
              setIsStoreEditModalOpen(true);
            }}
          />
        )}

        {/* Customer Wishlist Modal */}
        <WishlistModal
          isOpen={isWishlistOpen}
          wishlistIds={wishlistIds}
          allBooks={books}
          settings={safeSettings}
          bcvRates={bcvRates}
          onClose={() => setIsWishlistOpen(false)}
          onRemoveFromWishlist={toggleWishlist}
          onSelectBook={(book) => setSelectedBook(book)}
        />

        {/* Direct In-Store Publication Quick Editor Modal */}
        <PublicationEditorModal
          isOpen={isStoreEditModalOpen}
          bookToEdit={storeEditingBook}
          currencySymbol={safeSettings.currencySymbol}
          bcvRates={bcvRates}
          catalogs={catalogs}
          onClose={() => {
            setIsStoreEditModalOpen(false);
            setStoreEditingBook(null);
          }}
          onSave={(bookData, existingId) => {
            if (existingId) {
              const existing = books.find((b) => b.id === existingId) || storeEditingBook;
              const finalImages =
                bookData.images && bookData.images.length > 0
                  ? bookData.images.filter(Boolean)
                  : bookData.coverUrl
                  ? [bookData.coverUrl]
                  : existing?.images || [];
              const finalCover = finalImages[0] || bookData.coverUrl || existing?.coverUrl || FALLBACK_BOOK_COVER;

              const updated: Book = {
                ...(existing || {}),
                ...bookData,
                id: existingId,
                createdAt: existing?.createdAt || Date.now(),
                coverUrl: finalCover,
                images: finalImages.length > 0 ? finalImages : [finalCover],
                price: Number(bookData.price) || 0,
                editorial: bookData.editorial || '',
                isbn: bookData.isbn || '',
              };
              updateBook(updated);
              showStoreToast(`Publicación «${updated.title}» actualizada con éxito. Cambios visibles de inmediato para los clientes.`);
            } else {
              const created = addBook(bookData);
              showStoreToast(`Nueva publicación «${created.title}» agregada y publicada con éxito.`);
            }
            setIsStoreEditModalOpen(false);
            setStoreEditingBook(null);
          }}
          onOpenFullAdmin={() => {
            setIsStoreEditModalOpen(false);
            setDirectEditBook(storeEditingBook);
            setIsAdminOpen(true);
          }}
        />

        {/* Quick Floating WhatsApp Action Button on bottom-right for Customers */}
        <a
          href={floatingWhatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          id="floating-whatsapp-btn"
          className="fixed right-6 bottom-6 z-30 bg-[#25D366] hover:bg-[#20ba5a] text-white p-3.5 sm:px-4 sm:py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2.5 group transform hover:scale-105"
          title="Consultar por WhatsApp"
        >
          <MessageCircle className="w-6 h-6 fill-white shrink-0" />
          <span className="hidden sm:inline text-xs font-bold tracking-wide">
            ¿Deseas consultar un libro?
          </span>
        </a>

        {/* Floating PWA Install Prompt Banner */}
        <PWAInstallPrompt
          manualTrigger={manualInstallTrigger}
          onManualTriggerHandled={() => setManualInstallTrigger(false)}
        />
      </div>
    </div>
  );
}
