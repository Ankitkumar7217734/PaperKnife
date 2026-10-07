import { useEffect, useRef, useState } from 'react'
import { Zap, Loader2, Plus, X, FileIcon, Download, ChevronLeft, ChevronRight, Maximize2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import JSZip from 'jszip'
import { Capacitor } from '@capacitor/core'

import { getPdfMetaData, loadPdfDocument, renderPageThumbnail, unlockPdf, downloadFile } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { useObjectURL } from '../../utils/useObjectURL'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

type CompressionQuality = 'low' | 'medium' | 'high'

type CompressionPreset = {
  scale: number
  textScale: number
  jpegQuality: number
  maxDimension: number
  maxPixels: number
  pngSizeRatio: number
  pngTrialMaxBytes: number
}

type PageImageFormat = 'jpeg' | 'png'

const COMPRESSION_PRESETS: Record<CompressionQuality, CompressionPreset> = {
  high: { scale: 1.75, textScale: 2.0, jpegQuality: 0.9, maxDimension: 3200, maxPixels: 7_000_000, pngSizeRatio: 1.6, pngTrialMaxBytes: 1_000_000 },
  medium: { scale: 1.3, textScale: 1.6, jpegQuality: 0.76, maxDimension: 2400, maxPixels: 4_000_000, pngSizeRatio: 1.3, pngTrialMaxBytes: 650_000 },
  low: { scale: 0.9, textScale: 1.1, jpegQuality: 0.55, maxDimension: 1600, maxPixels: 2_000_000, pngSizeRatio: 1.05, pngTrialMaxBytes: 400_000 },
}

const MIN_TEXT_CHARACTERS = 24

const compressedFileName = (name: string) => name.replace(/\.pdf$/i, '') + '-compressed.pdf'

const sendWorkerRequest = <T,>(
  worker: Worker,
  message: unknown,
  expectedType: string,
  transfer: Transferable[] = [],
): Promise<T> => new Promise((resolve, reject) => {
  const cleanup = () => {
    worker.removeEventListener('message', handleMessage)
    worker.removeEventListener('error', handleError)
  }

  const handleMessage = (event: MessageEvent) => {
    const responseType = event.data?.type
    if (responseType === 'ERROR') {
      cleanup()
      reject(new Error(typeof event.data.payload === 'string' ? event.data.payload : 'Compression worker failed.'))
    } else if (responseType === expectedType) {
      cleanup()
      resolve(event.data.payload as T)
    }
  }

  const handleError = (event: ErrorEvent) => {
    cleanup()
    reject(new Error(event.message || 'Compression worker failed to start.'))
  }

  worker.addEventListener('message', handleMessage)
  worker.addEventListener('error', handleError)

  try {
    worker.postMessage(message, transfer)
  } catch (error) {
    cleanup()
    reject(error)
  }
})

const countPageTextCharacters = async (page: any): Promise<number> => {
  try {
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    return textContent.items.reduce((total: number, item: any) => {
      const text = typeof item?.str === 'string' ? item.str.replace(/\s/g, '') : ''
      return total + text.length
    }, 0)
  } catch {
    return 0
  }
}

const encodeCanvas = (canvas: HTMLCanvasElement, mimeType: 'image/jpeg' | 'image/png', quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Could not encode a PDF page.')),
    mimeType,
    quality,
  )
})

const renderPageAsImage = async (page: any, preset: CompressionPreset) => {
  const textCharacterCount = await countPageTextCharacters(page)
  const hasMeaningfulText = textCharacterCount >= MIN_TEXT_CHARACTERS
  const pageViewport = page.getViewport({ scale: 1 })
  const requestedScale = hasMeaningfulText ? preset.textScale : preset.scale
  const requestedWidth = pageViewport.width * requestedScale
  const requestedHeight = pageViewport.height * requestedScale
  const dimensionLimit = Math.min(1, preset.maxDimension / Math.max(requestedWidth, requestedHeight))
  const pixelLimit = Math.min(1, Math.sqrt(preset.maxPixels / (requestedWidth * requestedHeight)))
  const effectiveScale = Math.max(0.1, requestedScale * Math.min(dimensionLimit, pixelLimit))
  const renderViewport = page.getViewport({ scale: effectiveScale })
  const canvas = document.createElement('canvas')

  try {
    canvas.width = Math.max(1, Math.ceil(renderViewport.width))
    canvas.height = Math.max(1, Math.ceil(renderViewport.height))
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!context) throw new Error('Canvas rendering is not available on this device.')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    await page.render({
      canvasContext: context,
      viewport: renderViewport,
      intent: 'display',
      background: '#ffffff',
    }).promise

    const jpegBlob = await encodeCanvas(canvas, 'image/jpeg', preset.jpegQuality)
    let imageBlob = jpegBlob
    let imageFormat: PageImageFormat = 'jpeg'

    // Simple text pages often compress better as PNG and avoid JPEG ringing around
    // character edges. The byte-ratio guard prevents photo-heavy pages from bloating.
    if (hasMeaningfulText && jpegBlob.size <= preset.pngTrialMaxBytes) {
      try {
        const pngBlob = await encodeCanvas(canvas, 'image/png')
        if (pngBlob.size <= jpegBlob.size * preset.pngSizeRatio) {
          imageBlob = pngBlob
          imageFormat = 'png'
        }
      } catch {
        // JPEG remains a safe fallback when PNG encoding is unavailable.
      }
    }

    return {
      imageBytes: new Uint8Array(await imageBlob.arrayBuffer()),
      imageFormat,
      pageWidth: pageViewport.width,
      pageHeight: pageViewport.height,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
    page.cleanup?.()
  }
}

// Compare Slider Component
const QualityCompare = ({ originalThumbnail, compressedBuffer }: { originalThumbnail: string, compressedBuffer: Uint8Array }) => {
  const [compressedThumb, setCompressedThumb] = useState<string>('')
  const [sliderPos, setSliderPos] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let compPdf: any

    const loadThumb = async () => {
      try {
        compPdf = await loadPdfDocument(new File([compressedBuffer as any], 'comp.pdf', { type: 'application/pdf' }))
        const thumbnail = await renderPageThumbnail(compPdf, 1, 2.0)
        if (!cancelled) setCompressedThumb(thumbnail)
      } catch (error) {
        console.error('Could not create the compressed PDF comparison:', error)
      } finally {
        try { await compPdf?.destroy?.() } catch { /* Best-effort PDF.js cleanup. */ }
      }
    }

    loadThumb()
    return () => { cancelled = true }
  }, [compressedBuffer])

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const position = ((x - rect.left) / rect.width) * 100
    setSliderPos(Math.max(0, Math.min(100, position)))
  }

  if (!compressedThumb) return (
    <div className="h-64 flex flex-col items-center justify-center bg-gray-50 dark:bg-zinc-900 rounded-[2rem] animate-pulse">
      <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-[10px] font-black uppercase text-gray-400">Comparing Quality...</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-2">
        <h4 className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-2"><Maximize2 size={12} /> Quality Inspection</h4>
      </div>
      <div ref={containerRef} className="relative h-80 md:h-[400px] rounded-[2rem] overflow-hidden cursor-ew-resize select-none border border-pk-border dark:border-white/5" onMouseMove={handleMove} onTouchMove={handleMove}>
        <img src={compressedThumb} className="absolute inset-0 w-full h-full object-contain bg-white" alt="Compressed" />
        <div className="absolute inset-0 w-full h-full overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
          <img src={originalThumbnail} className="absolute inset-0 w-full h-full object-contain bg-white" alt="Original" />
        </div>
        <div className="absolute top-0 bottom-0 w-1 bg-white shadow-xl z-10" style={{ left: `${sliderPos}%` }}>
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-pk-surface dark:bg-zinc-900 rounded-full shadow-2xl border border-pk-border dark:border-white/5 flex items-center justify-center text-rose-500">
            <ChevronLeft size={14} /><ChevronRight size={14} />
          </div>
        </div>
      </div>
    </div>
  )
}

type CompressPdfFile = {
  id: string
  file: File
  thumbnail?: string
  pageCount: number
  isLocked: boolean
  metadataStatus: 'loading' | 'ready'
  pdfDoc?: any
  password?: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  resultUrl?: string
  resultSize?: number
  resultBuffer?: Uint8Array
  didReduce?: boolean
}

export default function CompressTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeWorkerRef = useRef<Worker | null>(null)
  const { consumePipelineFile, setPipelineFile } = usePipeline()
  const { objectUrl, createUrl, clearUrls } = useObjectURL()
  const [files, setFiles] = useState<CompressPdfFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [globalProgress, setGlobalProgress] = useState(0)
  const [quality, setQuality] = useState<CompressionQuality>('medium')
  const [showSuccess, setShowSuccess] = useState(false)
  const isNative = Capacitor.isNativePlatform()

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      if (pipelined.type && pipelined.type !== 'application/pdf') {
        toast.error('The file from the previous tool is not a PDF and cannot be used here.')
        return
      }
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFiles([file])
    }
  }, [])

  useEffect(() => () => {
    activeWorkerRef.current?.terminate()
  }, [])

  const handleFiles = async (selectedFiles: FileList | File[]) => {
    const newFiles: CompressPdfFile[] = Array.from(selectedFiles)
      .filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      .map(file => ({
        id: Math.random().toString(36).slice(2, 11),
        file,
        pageCount: 0,
        isLocked: false,
        metadataStatus: 'loading',
        status: 'pending',
      }))

    if (newFiles.length === 0) {
      toast.error('Please select a PDF file.')
      return
    }

    setFiles(previous => [...previous, ...newFiles])
    setShowSuccess(false)
    clearUrls()
    if (fileInputRef.current) fileInputRef.current.value = ''

    // Read batch metadata sequentially so several large PDFs are not parsed in memory together.
    for (const item of newFiles) {
      const meta = await getPdfMetaData(item.file)
      setFiles(previous => previous.map(file => file.id === item.id ? {
        ...file,
        pageCount: meta.pageCount,
        isLocked: meta.isLocked,
        thumbnail: meta.thumbnail,
        metadataStatus: 'ready',
      } : file))
    }
  }

  const handleUnlock = async (id: string, password: string) => {
    const item = files.find(file => file.id === id)
    if (!item) return

    const result = await unlockPdf(item.file, password)
    if (result.success) {
      setFiles(previous => previous.map(file => file.id === id ? {
        ...file,
        isLocked: false,
        pageCount: result.pageCount,
        pdfDoc: result.pdfDoc,
        thumbnail: result.thumbnail,
        password,
        metadataStatus: 'ready',
      } : file))
    } else {
      toast.error('Incorrect password')
    }
  }

  const compressSingleFile = async (
    item: CompressPdfFile,
    selectedQuality: CompressionQuality,
    onProgress?: (progress: number) => void,
  ): Promise<{ url: string, size: number, buffer: Uint8Array, didReduce: boolean }> => {
    const pdfDoc = item.pdfDoc || await loadPdfDocument(item.file, item.password)
    const pageCount = pdfDoc.numPages
    if (pageCount < 1) throw new Error('This PDF does not contain any pages.')

    const worker = new Worker(new URL('../../utils/pdfWorker.ts', import.meta.url), { type: 'module' })
    activeWorkerRef.current = worker

    try {
      await sendWorkerRequest<void>(worker, { type: 'COMPRESS_PDF_INIT' }, 'COMPRESS_PDF_READY')
      const preset = COMPRESSION_PRESETS[selectedQuality]

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const page = await pdfDoc.getPage(pageNumber)
        const pageData = await renderPageAsImage(page, preset)
        onProgress?.(Math.round(((pageNumber - 0.35) / pageCount) * 94))

        await sendWorkerRequest<void>(
          worker,
          { type: 'COMPRESS_PDF_PAGE', payload: pageData },
          'COMPRESS_PDF_PAGE_ADDED',
          [pageData.imageBytes.buffer as ArrayBuffer],
        )
        onProgress?.(Math.round((pageNumber / pageCount) * 94))
      }

      onProgress?.(96)
      const payload = await sendWorkerRequest<Uint8Array | ArrayBuffer>(
        worker,
        { type: 'COMPRESS_PDF_FINISH' },
        'SUCCESS',
      )
      const compressedBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
      onProgress?.(100)

      // Rasterization can enlarge PDFs that are already highly optimized. Never return a larger file.
      if (compressedBytes.byteLength >= item.file.size) {
        const originalBytes = new Uint8Array(await item.file.arrayBuffer())
        return {
          url: createUrl(item.file),
          size: item.file.size,
          buffer: originalBytes,
          didReduce: false,
        }
      }

      const blob = new Blob([compressedBytes as any], { type: 'application/pdf' })
      return {
        url: createUrl(blob),
        size: blob.size,
        buffer: compressedBytes,
        didReduce: true,
      }
    } finally {
      worker.terminate()
      if (activeWorkerRef.current === worker) activeWorkerRef.current = null
      try { await pdfDoc.destroy?.() } catch { /* Best-effort PDF.js cleanup. */ }
    }
  }

  const startBatchCompression = async () => {
    const compressibleFiles = files.filter(file =>
      !file.isLocked &&
      file.metadataStatus === 'ready' &&
      (file.status === 'pending' || file.status === 'error')
    )

    if (compressibleFiles.length === 0) {
      if (files.some(file => file.isLocked)) toast.error('Unlock the PDF before compressing it.')
      return
    }

    setIsProcessing(true)
    setGlobalProgress(0)
    let successCount = 0
    let failureCount = 0
    const isSingle = compressibleFiles.length === 1 && files.length === 1

    for (let index = 0; index < compressibleFiles.length; index++) {
      const item = compressibleFiles[index]
      setFiles(previous => previous.map(file => file.id === item.id ? { ...file, status: 'processing' } : file))

      try {
        const { url, size, buffer, didReduce } = await compressSingleFile(
          item,
          quality,
          isSingle ? setGlobalProgress : undefined,
        )
        successCount++
        const outputName = compressedFileName(item.file.name)

        setFiles(previous => previous.map(file => file.id === item.id ? {
          ...file,
          status: 'completed',
          pdfDoc: undefined,
          resultUrl: url,
          resultSize: size,
          resultBuffer: isSingle ? buffer : undefined,
          didReduce,
        } : file))
        addActivity({ name: outputName, tool: 'Compress', size, resultUrl: url })

        if (isSingle) {
          setPipelineFile({ buffer, name: outputName, type: 'application/pdf' })
        }
      } catch (error) {
        failureCount++
        console.error(`Could not compress ${item.file.name}:`, error)
        setFiles(previous => previous.map(file => file.id === item.id ? {
          ...file,
          status: 'error',
          pdfDoc: undefined,
        } : file))
      }

      if (!isSingle) setGlobalProgress(Math.round(((index + 1) / compressibleFiles.length) * 100))
    }

    setIsProcessing(false)
    if (failureCount > 0) toast.error(`${failureCount} PDF${failureCount === 1 ? '' : 's'} could not be compressed.`)
    if (successCount > 0) setShowSuccess(true)
  }

  const handleDownloadBatch = async () => {
    const completedFiles = files.filter(file => file.resultUrl)
    if (completedFiles.length === 0) return

    try {
      toast.loading('Creating ZIP archive...', { id: 'compress-zip' })
      const zip = new JSZip()
      for (const file of completedFiles) {
        const response = await fetch(file.resultUrl!)
        zip.file(compressedFileName(file.file.name), await response.arrayBuffer())
      }
      const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: true })
      await downloadFile(zipBytes, 'paperknife-compressed.zip', 'application/zip')
      toast.success('ZIP archive saved.', { id: 'compress-zip' })
    } catch (error) {
      console.error('Could not create compression ZIP:', error)
      toast.error('Could not create the ZIP archive.', { id: 'compress-zip' })
    }
  }

  const ActionButton = () => {
    const metadataLoading = files.some(file => file.metadataStatus === 'loading')
    const compressibleCount = files.filter(file =>
      !file.isLocked &&
      file.metadataStatus === 'ready' &&
      (file.status === 'pending' || file.status === 'error')
    ).length

    return (
      <button
        onClick={startBatchCompression}
        disabled={isProcessing || metadataLoading || compressibleCount === 0}
        className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl"
      >
        {isProcessing
          ? <><Loader2 className="animate-spin" /> {globalProgress}%</>
          : <>{metadataLoading ? 'Reading PDF...' : `Compress ${files.length > 1 ? `${compressibleCount} Files` : 'PDF'}`} <ArrowRight size={18} /></>}
      </button>
    )
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB']
    let value = bytes / 1024
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex++
    }
    const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2
    return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
  }

  const completedFiles = files.filter(file => file.resultUrl && typeof file.resultSize === 'number')
  const completedCount = completedFiles.length
  const totalOriginalSize = completedFiles.reduce((total, file) => total + file.file.size, 0)
  const totalFinalSize = completedFiles.reduce((total, file) => total + (file.resultSize || 0), 0)
  const totalSavedSize = Math.max(0, totalOriginalSize - totalFinalSize)
  const totalReduction = totalOriginalSize > 0 ? (totalSavedSize / totalOriginalSize) * 100 : 0
  const singleFile = files[0]
  const reduction = singleFile?.resultSize
    ? Math.max(0, (1 - singleFile.resultSize / singleFile.file.size) * 100)
    : 0
  const successMessage = singleFile?.didReduce === false
    ? `Already optimized — ${formatFileSize(singleFile?.resultSize || singleFile?.file.size || 0)} (unchanged)`
    : `${formatFileSize(singleFile?.file.size || 0)} → ${formatFileSize(singleFile?.resultSize || 0)} · Saved ${reduction.toFixed(0)}%`

  return (
    <NativeToolLayout title="Compress PDF" description="Reduce file size while maintaining quality. Everything stays on your device." actions={files.length > 0 && !showSuccess && <ActionButton />}>
      <input type="file" multiple accept=".pdf,application/pdf" className="hidden" ref={fileInputRef} onChange={(event) => event.target.files && handleFiles(event.target.files)} />

      {files.length === 0 ? (
        <button
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className="w-full border-4 border-dashed border-pk-border dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group"
        >
          <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-inner"><Zap size={32} /></div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select PDFs</h3>
          <p className="text-sm text-gray-400 font-medium">Tap to start batch compression</p>
        </button>
      ) : !showSuccess ? (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {files.map(file => (
              <div key={file.id} className="bg-pk-surface dark:bg-zinc-900 p-4 rounded-[1.5rem] border border-pk-border dark:border-white/5 flex items-center gap-4 relative group shadow-sm">
                <div className="w-12 h-16 bg-pk-surface-muted dark:bg-zinc-950 rounded-lg overflow-hidden shrink-0 border border-pk-border dark:border-zinc-800">
                  {file.thumbnail ? <img src={file.thumbnail} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center"><FileIcon className="text-gray-300" size={16} /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black truncate dark:text-white">{file.file.name}</p>
                  {file.metadataStatus === 'loading' ? (
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Reading PDF...</p>
                  ) : file.isLocked ? (
                    <div className="flex gap-1 mt-1">
                      <input type="password" placeholder="Locked..." className="flex-1 bg-pk-surface-muted dark:bg-zinc-950 text-[10px] p-1.5 rounded-lg outline-none w-full border border-pk-border dark:border-zinc-800 focus:border-rose-500" onKeyDown={(event) => { if (event.key === 'Enter') handleUnlock(file.id, event.currentTarget.value) }} />
                    </div>
                  ) : file.status === 'error' ? (
                    <p className="text-[10px] text-red-500 font-bold uppercase">Failed — tap Compress to retry</p>
                  ) : (
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{(file.file.size / (1024 * 1024)).toFixed(2)} MB • {file.pageCount} Pages</p>
                  )}
                </div>
                <button disabled={isProcessing} onClick={() => setFiles(previous => previous.filter(item => item.id !== file.id))} className="p-2 text-gray-300 hover:text-rose-500 transition-colors disabled:opacity-40"><X size={16} /></button>
              </div>
            ))}
            <button disabled={isProcessing} onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-pk-border dark:border-zinc-800 rounded-[1.5rem] p-4 text-gray-400 flex flex-col items-center justify-center gap-1 hover:border-rose-500 hover:text-rose-500 transition-all disabled:opacity-40">
              <Plus size={20} /><span className="text-[10px] font-black uppercase tracking-widest">Add More</span>
            </button>
          </div>

          <div className="bg-pk-surface dark:bg-zinc-900 p-8 rounded-[2rem] border border-pk-border dark:border-white/5 shadow-sm">
            <h4 className="text-[10px] font-black uppercase text-gray-400 mb-6 tracking-widest px-1">Compression Strategy</h4>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'high', label: 'High Quality', desc: 'Sharpest Text' },
                { id: 'medium', label: 'Standard', desc: 'Clear & Balanced' },
                { id: 'low', label: 'Smallest', desc: 'Readable & Small' },
              ].map(level => (
                <button disabled={isProcessing} key={level.id} onClick={() => setQuality(level.id as CompressionQuality)} className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 disabled:opacity-40 ${quality === level.id ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-pk-border dark:border-white/5'}`}>
                  <span className={`font-black uppercase text-[9px] text-center leading-tight ${quality === level.id ? 'text-rose-500' : 'text-gray-400'}`}>{level.label}</span>
                  <span className="text-[8px] text-gray-400 font-bold uppercase">{level.desc}</span>
                </button>
              ))}
            </div>

            <div className="mt-6 p-6 bg-pk-surface-muted dark:bg-zinc-950 rounded-2xl border border-pk-border dark:border-white/5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center"><Zap size={16} /></div>
                <h5 className="text-xs font-black uppercase tracking-widest dark:text-white">Strategy Details</h5>
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                {quality === 'high' && <><strong>High Quality:</strong> Highest bounded resolution and gentler encoding for sharp text, forms, and detailed reports.</>}
                {quality === 'medium' && <><strong>Standard:</strong> Clearer text with balanced image compression for everyday sharing and email attachments.</>}
                {quality === 'low' && <><strong>Smallest Size:</strong> Stronger compression while retaining a more readable text resolution for mobile viewing.</>}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-zinc-500 leading-relaxed mt-3">
                Text-heavy pages receive extra resolution and lossless encoding when size-efficient. Searchable text, links, forms, and other interactive elements are still flattened.
              </p>
            </div>

            {isProcessing && (
              <div className="mt-8 space-y-3">
                <div className="w-full bg-gray-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden shadow-inner">
                  <div className="bg-rose-500 h-full transition-all" style={{ width: `${globalProgress}%` }} />
                </div>
                <p className="text-[10px] text-center font-black uppercase text-gray-400 tracking-widest animate-pulse">Optimizing pages locally...</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in zoom-in duration-300">
          {completedFiles.length > 0 && (
            <section aria-label="Compression size summary" className="bg-pk-surface dark:bg-zinc-900 p-5 md:p-6 rounded-[2rem] border border-pk-border dark:border-white/5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{files.length > 1 ? 'Combined PDF size' : 'Completed file size'}</p>
                  <h3 className="text-lg font-black dark:text-white mt-1">Ready to download</h3>
                </div>
                <span className="shrink-0 rounded-full bg-green-50 dark:bg-green-900/20 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-green-600 dark:text-green-400">Complete</span>
              </div>

              <dl className="grid grid-cols-3 gap-2 md:gap-3">
                <div className="rounded-2xl bg-pk-surface-muted dark:bg-zinc-950 p-3 md:p-4 border border-pk-border dark:border-white/5 min-w-0">
                  <dt className="text-[8px] md:text-[9px] font-black uppercase tracking-wider text-gray-400">Original</dt>
                  <dd title={`${totalOriginalSize.toLocaleString()} bytes`} className="mt-1 text-xs md:text-base font-black dark:text-white truncate">{formatFileSize(totalOriginalSize)}</dd>
                </div>
                <div className="rounded-2xl bg-rose-50 dark:bg-rose-900/10 p-3 md:p-4 border border-rose-100 dark:border-rose-900/20 min-w-0">
                  <dt className="text-[8px] md:text-[9px] font-black uppercase tracking-wider text-rose-400">{files.length > 1 ? 'PDF Total' : 'Final Size'}</dt>
                  <dd title={`${totalFinalSize.toLocaleString()} bytes`} className="mt-1 text-xs md:text-base font-black text-rose-500 truncate">{formatFileSize(totalFinalSize)}</dd>
                </div>
                <div className="rounded-2xl bg-green-50 dark:bg-green-900/10 p-3 md:p-4 border border-green-100 dark:border-green-900/20 min-w-0">
                  <dt className="text-[8px] md:text-[9px] font-black uppercase tracking-wider text-green-500">Saved</dt>
                  <dd title={`${totalSavedSize.toLocaleString()} bytes saved`} className="mt-1 text-xs md:text-base font-black text-green-600 dark:text-green-400 truncate">{formatFileSize(totalSavedSize)} <span className="text-[9px] md:text-xs">({totalReduction.toFixed(0)}%)</span></dd>
                </div>
              </dl>

              {files.length > 1 && (
                <div className="mt-4 pt-4 border-t border-pk-border dark:border-white/5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Individual PDFs</p>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {completedFiles.map(file => (
                      <div key={file.id} className="flex items-center justify-between gap-3 text-[10px] md:text-xs">
                        <span title={file.file.name} className="font-bold dark:text-zinc-300 truncate">{file.file.name}</span>
                        <span className="shrink-0 font-black text-gray-500 dark:text-zinc-400">{formatFileSize(file.file.size)} <span className="text-gray-300 dark:text-zinc-700 mx-1">→</span> <span className="text-rose-500">{formatFileSize(file.resultSize || 0)}</span></span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-gray-400 dark:text-zinc-500 mt-3">The ZIP download will be slightly larger than this combined PDF total because of archive packaging.</p>
                </div>
              )}
            </section>
          )}

          {objectUrl && files.length > 1 && (
            <button onClick={handleDownloadBatch} className="block w-full bg-zinc-900 dark:bg-white text-white dark:text-black p-10 rounded-[2.5rem] text-center shadow-2xl transition-all group active:scale-[0.98]">
              <div className="w-16 h-16 bg-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-lg"><Download className="text-white" size={32} /></div>
              <h3 className="text-2xl font-black tracking-tight mb-1">{isNative ? 'Save ZIP Archive' : 'Download ZIP Archive'}</h3>
              <p className="text-xs font-bold opacity-60 uppercase tracking-widest">{completedCount} Optimized PDF{completedCount === 1 ? '' : 's'}</p>
            </button>
          )}
          {objectUrl && files.length === 1 && singleFile && (
            <div className="space-y-8">
              <SuccessState message={successMessage} downloadUrl={objectUrl} fileName={compressedFileName(singleFile.file.name)} onStartOver={() => { setFiles([]); setShowSuccess(false); clearUrls(); setIsProcessing(false) }} />
              {singleFile.didReduce && singleFile.thumbnail && singleFile.resultBuffer && (
                <div className="bg-pk-surface dark:bg-zinc-900 p-6 rounded-[2.5rem] border border-pk-border dark:border-white/5 shadow-sm">
                  <QualityCompare originalThumbnail={singleFile.thumbnail} compressedBuffer={singleFile.resultBuffer} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <PrivacyBadge />
    </NativeToolLayout>
  )
}
