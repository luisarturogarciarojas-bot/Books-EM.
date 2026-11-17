import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  Sparkles,
  Check,
  AlertCircle,
  Eye,
  DollarSign,
  Star,
  BookOpen,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Images,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Book, BookStatus, CurrencyCode } from '../../types';
import { formatPrice, getStatusDetails, compressImageFile, uploadImageToServer, FALLBACK_BOOK_COVER } from '../../utils/helpers';
import { BcvRates, calculateBcvBreakdown, getCurrencySymbol } from '../../services/bcvRates';
import { PRESET_COVER_SUGGESTIONS } from '../../data/initialData';

interface PublicationEditorModalProps {
  isOpen: boolean;
  bookToEdit: Book | null;
  currencySymbol?: string;
  bcvRates?: BcvRates;
  catalogs?: string[];
  onClose: () => void;
  onSave: (bookData: Omit<Book, 'id' | 'createdAt'>, existingId?: string) => void;
  onOpenFullAdmin?: () => void;
}

const COMMON_GENRES = [
  'Novela',
  'Realismo Mágico',
  'Desarrollo Personal',
  'Misterio y Novela',
  'Ciencia Ficción Distópica',
  'Clásicos y Filosofía',
  'Thriller Psicológico',
  'Romance',
  'Historia y Ensayo',
  'Fantasía',
  'Infantil y Juvenil',
];

export const PublicationEditorModal: React.FC<PublicationEditorModalProps> = ({
  isOpen,
  bookToEdit,
  currencySymbol = '$',
  bcvRates,
  catalogs = COMMON_GENRES,
  onClose,
  onSave,
  onOpenFullAdmin,
}) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [genre, setGenre] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [price, setPrice] = useState<number>(15);
  const [status, setStatus] = useState<BookStatus>('disponible');
  const [featured, setFeatured] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [synopsis, setSynopsis] = useState('');
  const [editorial, setEditorial] = useState('');
  const [pages, setPages] = useState<number | ''>('');
  const [publishedYear, setPublishedYear] = useState<number | ''>('');
  const [isbn, setIsbn] = useState('');
  const [showPresetGallery, setShowPresetGallery] = useState(false);
  const [replacingImageIndex, setReplacingImageIndex] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Available catalog list
  const availableGenres = Array.from(
    new Set([...(catalogs || []), ...COMMON_GENRES].filter(Boolean))
  );

  useEffect(() => {
    if (!isOpen) return;

    if (bookToEdit) {
      setTitle(bookToEdit.title || '');
      setAuthor(bookToEdit.author || '');
      setGenre(bookToEdit.genre || 'Novela');
      setCurrency(bookToEdit.currency || 'USD');
      setPrice(Number(bookToEdit.price) || 0);
      setStatus(bookToEdit.status || 'disponible');
      setFeatured(Boolean(bookToEdit.featured));

      const initialImgs =
        Array.isArray(bookToEdit.images) && bookToEdit.images.length > 0
          ? bookToEdit.images.filter(Boolean)
          : bookToEdit.coverUrl
          ? [bookToEdit.coverUrl]
          : [];
      setImages(initialImgs);

      setSynopsis(bookToEdit.synopsis || '');
      setEditorial(bookToEdit.editorial || '');
      setPages(bookToEdit.pages || '');
      setPublishedYear(bookToEdit.publishedYear || '');
      setIsbn(bookToEdit.isbn || '');
      setShowAdvanced(Boolean(bookToEdit.editorial || bookToEdit.pages || bookToEdit.isbn));
    } else {
      setTitle('');
      setAuthor('');
      setGenre(availableGenres[0] || 'Novela');
      setCurrency('USD');
      setPrice(15);
      setStatus('disponible');
      setFeatured(false);
      setImages([]);
      setSynopsis('');
      setEditorial('');
      setPages('');
      setPublishedYear(new Date().getFullYear());
      setIsbn('');
      setShowAdvanced(false);
    }
    setErrorMessage('');
    setActivePreviewIndex(0);
    setShowPresetGallery(false);
    setReplacingImageIndex(null);
  }, [bookToEdit, isOpen]);

  if (!isOpen) return null;

  // Handle local file uploads with compression
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const validFiles: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        setErrorMessage('Uno o más archivos seleccionados no son imágenes válidas.');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setIsCompressing(true);
    setErrorMessage('');

    try {
      const uploadResults = await Promise.all(
        validFiles.map((file, idx) => uploadImageToServer(file, `libro_${idx + 1}`))
      );
      const validUrls = uploadResults.filter((url): url is string => Boolean(url && url.length > 0));
      setImages((prev) => [...prev, ...validUrls]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Error al subir y optimizar imágenes:', err);
      setErrorMessage('Hubo un error al procesar y subir las imágenes. Intenta nuevamente.');
    } finally {
      setIsCompressing(false);
    }
  };

  // Replace a specific image with a newly uploaded file
  const handleTriggerReplaceImage = (index: number) => {
    setReplacingImageIndex(index);
    if (replaceFileInputRef.current) {
      replaceFileInputRef.current.value = '';
      replaceFileInputRef.current.click();
    }
  };

  const handleReplaceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (replacingImageIndex === null) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      setErrorMessage('El archivo seleccionado no es una imagen válida.');
      return;
    }

    setIsCompressing(true);
    setErrorMessage('');
    try {
      const newUrl = await uploadImageToServer(file, `reemplazo_${replacingImageIndex + 1}`);
      if (newUrl) {
        setImages((prev) => {
          const next = [...prev];
          next[replacingImageIndex] = newUrl;
          return next;
        });
      }
    } catch (err) {
      console.error('Error al reemplazar imagen:', err);
      setErrorMessage('Error al procesar la nueva imagen.');
    } finally {
      setIsCompressing(false);
      setReplacingImageIndex(null);
      if (replaceFileInputRef.current) replaceFileInputRef.current.value = '';
    }
  };

  const makeCover = (index: number) => {
    if (index === 0) return;
    setImages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.unshift(item);
      return copy;
    });
    setActivePreviewIndex(0);
  };

  const handleSelectPresetCover = (url: string) => {
    setImages((prev) => [url, ...prev.filter((u) => u !== url)]);
    setShowPresetGallery(false);
    setActivePreviewIndex(0);
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (activePreviewIndex >= images.length - 1) {
      setActivePreviewIndex(0);
    }
  };

  const moveImage = (index: number, direction: 'left' | 'right') => {
    const target = direction === 'left' ? index - 1 : index + 1;
    if (target < 0 || target >= images.length) return;
    setImages((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy;
    });
  };

  const adjustPrice = (delta: number) => {
    setPrice((prev) => {
      const current = Number(prev) || 0;
      const updated = Math.max(0, current + delta);
      return currency === 'VES' ? Math.round(updated) : Number(updated.toFixed(2));
    });
  };

  const bcvBreakdown = bcvRates ? calculateBcvBreakdown(price, currency, bcvRates) : null;
  const currentSymbol = getCurrencySymbol(currency);
  const statusInfo = getStatusDetails(status);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage('El título de la publicación es obligatorio.');
      return;
    }
    if (!author.trim()) {
      setErrorMessage('El autor es obligatorio.');
      return;
    }
    if (price <= 0) {
      setErrorMessage('Por favor especifica un precio válido mayor a 0.');
      return;
    }

    const existingImgs = (Array.isArray(bookToEdit?.images) && bookToEdit.images.length > 0)
      ? bookToEdit.images.filter(Boolean)
      : (bookToEdit?.coverUrl ? [bookToEdit.coverUrl] : []);
    const finalImages = images.length > 0
      ? images.filter(Boolean)
      : (existingImgs.length > 0 ? existingImgs : [FALLBACK_BOOK_COVER]);
    const finalCover = finalImages[0] || bookToEdit?.coverUrl || FALLBACK_BOOK_COVER;
    const finalSynopsis = synopsis.trim() || `Publicación literaria de ${title.trim()}, escrita por ${author.trim()}. Consulta disponibilidad y entregas directas por WhatsApp.`;

    onSave(
      {
        title: title.trim(),
        author: author.trim(),
        genre: genre.trim() || 'Novela',
        price: Number(price) || 0,
        currency,
        status,
        featured,
        coverUrl: finalCover,
        images: finalImages,
        synopsis: finalSynopsis,
        editorial: editorial.trim() || '',
        pages: pages ? Number(pages) : undefined,
        publishedYear: publishedYear ? Number(publishedYear) : undefined,
        isbn: isbn.trim() || '',
      },
      bookToEdit?.id
    );
  };

  return (
    <div
      id="publication-editor-modal-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="publication-editor-modal-container"
        className="bg-white rounded-3xl border border-[#E8DFD0] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-[#2C2420] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-8 py-4 sm:py-5 border-b border-[#EFE8DF] flex items-center justify-between gap-3 bg-[#FAF7F2] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#5C3218] text-[#FAF7F2] flex items-center justify-center shadow-xs">
              <BookOpen className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif-title text-lg sm:text-xl font-bold text-[#3B2213]">
                  {bookToEdit ? 'Editar Publicación' : 'Nueva Publicación'}
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Visible para Clientes
                </span>
              </div>
              <p className="text-xs text-[#7A6455] mt-0.5">
                {bookToEdit
                  ? `Modifica los datos de «${bookToEdit.title}». Cada cambio se reflejará de inmediato en la tienda.`
                  : 'Completa la información para publicar un nuevo libro en el catálogo en vivo.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenFullAdmin && (
              <button
                type="button"
                onClick={onOpenFullAdmin}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#5C3218] hover:bg-[#EFE8DF] rounded-xl transition-colors cursor-pointer"
                title="Abrir panel de administración completo"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Panel Completo</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#7A6455] hover:text-[#3B2213] hover:bg-[#EFE8DF] transition-colors cursor-pointer"
              title="Cerrar ventana"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-5 sm:p-8 space-y-6">
          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Core Information Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Title */}
            <div>
              <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
                Título del Libro / Obra <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Cien Años de Soledad"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-sm font-medium focus:bg-white focus:border-[#8C5E3C] focus:ring-2 focus:ring-[#8C5E3C]/20 transition-all outline-hidden"
              />
            </div>

            {/* Author */}
            <div>
              <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
                Autor(a) <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Ej. Gabriel García Márquez"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-sm font-medium focus:bg-white focus:border-[#8C5E3C] focus:ring-2 focus:ring-[#8C5E3C]/20 transition-all outline-hidden"
              />
            </div>
          </div>

          {/* Pricing, Currency & Rates */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#FAF7F2] border border-[#E8DFC8] space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#E8DFC8] pb-3">
              <div>
                <span className="text-xs font-bold text-[#5C3218] uppercase tracking-wider">
                  Fijación de Precio y Moneda
                </span>
                <p className="text-[11px] text-[#7A6455] mt-0.5">
                  Los clientes verán este precio en su moneda y convertido automáticamente a tasa oficial BCV.
                </p>
              </div>

              {/* Currency Selector */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-[#DED4C7] shadow-2xs">
                {(['USD', 'EUR', 'VES'] as CurrencyCode[]).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrency(cur)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      currency === cur
                        ? 'bg-[#5C3218] text-white shadow-xs'
                        : 'text-[#6E5A4E] hover:bg-[#FAF7F2]'
                    }`}
                  >
                    {cur === 'USD' ? '$ USD' : cur === 'EUR' ? '€ EUR' : 'Bs. VES'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              {/* Price Input and adjustments */}
              <div>
                <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
                  Precio ({currentSymbol}) <span className="text-rose-600">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#8C5E3C]">
                      {currentSymbol}
                    </span>
                    <input
                      type="number"
                      step={currency === 'VES' ? '1' : '0.5'}
                      min="0"
                      required
                      value={price}
                      onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
                      className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-white text-base font-bold text-[#3B2213] focus:border-[#8C5E3C] focus:ring-2 focus:ring-[#8C5E3C]/20 transition-all outline-hidden"
                    />
                  </div>

                  {/* Quick price adjusters */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustPrice(-1)}
                      className="px-2.5 py-2 rounded-xl bg-white hover:bg-[#F4EFEB] border border-[#DED4C7] text-xs font-bold text-[#6E5A4E] cursor-pointer"
                      title="Restar 1"
                    >
                      -1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustPrice(1)}
                      className="px-2.5 py-2 rounded-xl bg-white hover:bg-[#F4EFEB] border border-[#DED4C7] text-xs font-bold text-[#6E5A4E] cursor-pointer"
                      title="Sumar 1"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustPrice(5)}
                      className="px-2.5 py-2 rounded-xl bg-white hover:bg-[#F4EFEB] border border-[#DED4C7] text-xs font-bold text-[#6E5A4E] cursor-pointer"
                      title="Sumar 5"
                    >
                      +5
                    </button>
                  </div>
                </div>
              </div>

              {/* BCV Breakdown Preview Box */}
              {bcvBreakdown && (
                <div className="p-3.5 rounded-xl bg-white border border-[#E2D7C8] shadow-2xs text-xs space-y-1">
                  <div className="flex items-center justify-between text-[#6E5A4E]">
                    <span className="flex items-center gap-1 font-semibold">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                      Conversión Tasa BCV:
                    </span>
                    <span className="font-bold text-[#3B2213]">{bcvBreakdown.originalFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8C5E3C] font-semibold">
                    <span>Equivalente en Bolívares:</span>
                    <span className="text-emerald-700 font-bold">{bcvBreakdown.bolivaresFormatted}</span>
                  </div>
                  {currency !== 'USD' && (
                    <div className="flex items-center justify-between text-[10px] text-[#A68F80]">
                      <span>Equivalente en Dólares:</span>
                      <span>{bcvBreakdown.usdFormatted}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Genre & Catalog Category + Availability Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* Genre */}
            <div>
              <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
                Género / Catálogo
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-sm font-medium focus:bg-white focus:border-[#8C5E3C] outline-hidden cursor-pointer"
              >
                {availableGenres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
                Estado de Disponibilidad
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BookStatus)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-sm font-medium focus:bg-white focus:border-[#8C5E3C] outline-hidden cursor-pointer"
              >
                <option value="disponible">🟢 Disponible para Entrega</option>
                <option value="bajo_pedido">🟡 Disponible Bajo Pedido</option>
                <option value="agotado">🔴 Agotado</option>
              </select>
            </div>

            {/* Featured Checkbox */}
            <div className="flex items-center sm:pt-6">
              <label className="flex items-center gap-2.5 cursor-pointer p-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] hover:bg-white transition-colors w-full">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  className="w-4 h-4 rounded text-[#5C3218] focus:ring-[#8C5E3C] cursor-pointer"
                />
                <span className="flex items-center gap-1.5 text-xs font-bold text-[#3B2213]">
                  <Star className={`w-3.5 h-3.5 ${featured ? 'fill-amber-400 text-amber-500' : 'text-stone-400'}`} />
                  Destacar en portada
                </span>
              </label>
            </div>
          </div>

          {/* Photo Gallery (Portada y fotos adicionales del libro) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#FAF7F2] border border-[#E8DFC8] space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#E8DFC8] pb-3">
              <div>
                <span className="text-xs font-bold text-[#5C3218] uppercase tracking-wider flex items-center gap-1.5">
                  <Images className="w-4 h-4 text-[#8C5E3C]" />
                  Fotos del Libro ({images.length})
                </span>
                <p className="text-[11px] text-[#7A6455] mt-0.5">
                  La primera imagen es la portada principal. Puedes subir fotos, reemplazarlas, cambiarlas de orden o elegir de la galería.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Hidden input for new batch uploads */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFilesUpload}
                  multiple
                  accept="image/*"
                  className="hidden"
                />

                {/* Hidden input for replacing a single image */}
                <input
                  type="file"
                  ref={replaceFileInputRef}
                  onChange={handleReplaceFileUpload}
                  accept="image/*"
                  className="hidden"
                />

                {/* Button: Choose Preset Cover */}
                <button
                  type="button"
                  onClick={() => setShowPresetGallery(!showPresetGallery)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  title="Elegir entre portadas literarias recomendadas"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                  <span>{showPresetGallery ? 'Ocultar Galería' : 'Portadas Listas'}</span>
                </button>

                {/* Button: Upload Photos */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isCompressing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5C3218] hover:bg-[#472611] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isCompressing ? 'Optimizando...' : 'Subir Fotos'}</span>
                </button>

              </div>
            </div>

            {/* Preset Covers Drawer */}
            {showPresetGallery && (
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    Selecciona una portada literaria para agregar o reemplazar:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPresetGallery(false)}
                    className="text-xs text-amber-800 hover:text-amber-950 font-semibold cursor-pointer"
                  >
                    ✕ Cerrar
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
                  {PRESET_COVER_SUGGESTIONS.map((preset, pIdx) => (
                    <button
                      type="button"
                      key={pIdx}
                      onClick={() => handleSelectPresetCover(preset.url)}
                      className="group flex flex-col items-center bg-white rounded-xl border border-amber-200 p-1.5 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left overflow-hidden"
                      title={`Elegir ${preset.label}`}
                    >
                      <div className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-stone-100 mb-1">
                        <img
                          src={preset.url}
                          alt={preset.label}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </div>
                      <span className="text-[10px] font-bold text-stone-700 line-clamp-1 w-full text-center">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Gallery Thumbnails List */}
            {images.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {images.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    className={`group relative rounded-xl overflow-hidden border-2 aspect-[3/4] bg-stone-100 shadow-xs flex flex-col justify-between transition-all ${
                      idx === 0 ? 'border-amber-500 ring-2 ring-amber-400/30' : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <img
                      src={imgUrl}
                      alt={`Foto ${idx + 1}`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />

                    {/* Top Status Tags */}
                    <div className="relative z-10 p-1.5 flex items-center justify-between pointer-events-none">
                      {idx === 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-bold shadow-xs flex items-center gap-1">
                          <Star className="w-2.5 h-2.5 fill-white" />
                          Portada
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-bold backdrop-blur-xs">
                          #{idx + 1}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="pointer-events-auto p-1 rounded-md bg-rose-600/90 hover:bg-rose-700 text-white shadow-xs cursor-pointer transition-colors"
                        title="Eliminar esta foto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Bottom Controls Bar */}
                    <div className="relative z-10 p-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent flex flex-col gap-1 text-white">
                      <div className="flex items-center justify-between gap-1">
                        {idx !== 0 ? (
                          <button
                            type="button"
                            onClick={() => makeCover(idx)}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-amber-950 transition-colors cursor-pointer"
                            title="Establecer como portada principal"
                          >
                            Hacer Portada
                          </button>
                        ) : (
                          <span className="text-[9px] font-bold text-amber-300">
                            Portada Activa
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleTriggerReplaceImage(idx)}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/90 hover:bg-white text-stone-900 transition-colors cursor-pointer flex items-center gap-0.5"
                          title="Reemplazar esta imagen por otra"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>Cambiar</span>
                        </button>
                      </div>

                      {/* Move left / right arrows */}
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[8px] text-stone-300">Reordenar:</span>
                        <div className="flex items-center gap-1">
                          {idx > 0 && (
                            <button
                              type="button"
                              onClick={() => moveImage(idx, 'left')}
                              className="p-1 rounded bg-white/20 hover:bg-white/40 text-white cursor-pointer"
                              title="Mover foto a la izquierda"
                            >
                              <ChevronLeft className="w-3 h-3" />
                            </button>
                          )}
                          {idx < images.length - 1 && (
                            <button
                              type="button"
                              onClick={() => moveImage(idx, 'right')}
                              className="p-1 rounded bg-white/20 hover:bg-white/40 text-white cursor-pointer"
                              title="Mover foto a la derecha"
                            >
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center rounded-xl border-2 border-dashed border-[#DED4C7] bg-white space-y-2">
                <ImageIcon className="w-8 h-8 text-stone-300 mx-auto mb-1" />
                <p className="text-xs font-semibold text-[#7A6455]">
                  Sin fotos aún. Puedes subir imágenes propias o elegir de nuestras portadas listas.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-[#5C3218] hover:bg-[#472611] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Subir desde Dispositivo / Cámara</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPresetGallery(true)}
                    className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                    <span>Elegir Portada de Galería</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Synopsis */}
          <div>
            <label className="block text-xs font-bold text-[#5C3218] mb-1.5">
              Sinopsis / Reseña Literaria
            </label>
            <textarea
              rows={4}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Escribe una breve descripción atractiva del libro para que los clientes conozcan la historia..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-sm font-medium focus:bg-white focus:border-[#8C5E3C] focus:ring-2 focus:ring-[#8C5E3C]/20 transition-all outline-hidden resize-y"
            />
          </div>

          {/* Collapsible Advanced Details */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs font-bold text-[#5C3218] hover:text-[#3B2213] cursor-pointer"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>Detalles Adicionales (Editorial, Páginas, Año, ISBN)</span>
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-3 pt-3 border-t border-[#EFE8DF] animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-bold text-[#6E5A4E] mb-1">Editorial</label>
                  <input
                    type="text"
                    value={editorial}
                    onChange={(e) => setEditorial(e.target.value)}
                    placeholder="Ej. Planeta / Alfaguara"
                    className="w-full px-3 py-2 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-xs focus:bg-white outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6E5A4E] mb-1">Nº Páginas</label>
                  <input
                    type="number"
                    min="1"
                    value={pages}
                    onChange={(e) => setPages(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ej. 340"
                    className="w-full px-3 py-2 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-xs focus:bg-white outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6E5A4E] mb-1">Año de Publicación</label>
                  <input
                    type="number"
                    min="1800"
                    max={new Date().getFullYear() + 1}
                    value={publishedYear}
                    onChange={(e) => setPublishedYear(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ej. 2023"
                    className="w-full px-3 py-2 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-xs focus:bg-white outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6E5A4E] mb-1">ISBN / Código</label>
                  <input
                    type="text"
                    value={isbn}
                    onChange={(e) => setIsbn(e.target.value)}
                    placeholder="Ej. 978-0307474728"
                    className="w-full px-3 py-2 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] text-xs focus:bg-white outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sticky Bottom Actions Bar */}
          <div className="pt-4 border-t border-[#EFE8DF] flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 sm:px-5 py-2.5 rounded-xl border border-[#DED4C7] bg-[#FAF7F2] hover:bg-[#F2ECE4] text-xs font-bold text-[#6E5A4E] transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                id="publication-save-btn"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all transform active:scale-95 cursor-pointer"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>{bookToEdit ? 'Guardar y Publicar Cambios' : 'Publicar en el Catálogo'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
