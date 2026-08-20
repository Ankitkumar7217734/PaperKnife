import { useState, useRef, useEffect } from 'react'
import { Plus, X, Loader2, GripVertical, Lock, RotateCw, Upload, RefreshCw, ArrowRight, ArrowLeft, Check } from 'lucide-react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'

import { getPdfMetaData, loadPdfDocument, renderGridThumbnail, unlockPdf } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { useObjectURL } from '../../utils/useObjectURL'
import { saveWorkspace, getWorkspace, clearWorkspace } from '../../utils/workspacePersistence'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

// File Item Type
type PdfFile = {
  id: string
  file: File
  thumbnail?: string
  pageCount: number
  isLocked: boolean
  rotation: number
  password?: string
}

type MergedPdfDraft = {
  buffer: Uint8Array
  pdfDoc: any
  pageCount: number
}

// Format File Size helper
const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Draggable Item Component
function SortableItem({ id, file, onRemove, onRotate, onUnlock }: { id: string, file: PdfFile, onRemove: (id: string) => void, onRotate: (id: string) => void, onUnlock: (id: string, pass: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const [localPass, setLocalPass] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    position: 'relative' as const,
  }

  const handleUnlockClick = async () => {
    setIsUnlocking(true)
    await onUnlock(id, localPass)
    setIsUnlocking(false)
  }

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-3 p-3 bg-pk-surface dark:bg-zinc-900 rounded-2xl border transition-all shadow-sm group touch-none relative ${isDragging ? 'border-rose-300 dark:border-rose-800 shadow-xl scale-[1.02] ring-4 ring-rose-500/10' : 'border-pk-border dark:border-zinc-800 hover:border-rose-200 dark:hover:border-rose-900/30'}`}>
      <div {...attributes} {...listeners} className="p-2 cursor-grab text-rose-400 hover:text-rose-600 dark:text-rose-500/50 dark:hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors active:scale-90">
        <GripVertical size={20} />
      </div>
      
      <div className="w-12 h-16 bg-gray-50 dark:bg-zinc-800 rounded-lg overflow-hidden shrink-0 border border-pk-border dark:border-zinc-800 relative group-hover:shadow-md transition-shadow">
        {file.isLocked ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-black text-rose-500">
            <Lock size={16} />
            <span className="text-[8px] font-black uppercase mt-1 text-center px-1">Locked</span>
          </div>
        ) : file.thumbnail ? (
          <img 
            src={file.thumbnail} 
            alt="Preview" 
            className="w-full h-full object-cover transition-transform duration-500" 
            style={{ transform: `rotate(${file.rotation}deg)` }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center animate-pulse">
            <div className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold text-sm truncate text-gray-900 dark:text-white group-hover:text-rose-500 transition-colors">{file.file.name}</p>
          {file.isLocked && <Lock size={12} className="text-rose-500 shrink-0" />}
        </div>
        
        {file.isLocked ? (
          <div className="flex gap-1 mt-1">
            <input 
              type="password" 
              placeholder="Password" 
              value={localPass}
              onChange={(e) => setLocalPass(e.target.value)}
              className="flex-1 bg-pk-surface-muted dark:bg-zinc-950 border border-pk-border dark:border-zinc-800 rounded-lg px-2 py-1 text-[10px] font-bold outline-none focus:border-rose-500 text-gray-900 dark:text-white"
            />
            <button 
              onClick={handleUnlockClick}
              disabled={!localPass || isUnlocking}
              className="bg-rose-500 text-white px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest disabled:opacity-50 hover:scale-105 active:scale-95 transition-transform"
            >
              {isUnlocking ? '...' : 'Unlock'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
            <span>{formatSize(file.file.size)}</span>
            {file.pageCount > 0 && (
              <>
                <span>•</span>
                <span>{file.pageCount} pages</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {!file.isLocked && (
          <button 
            onClick={() => onRotate(id)}
            className="p-2 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-full text-gray-400 hover:text-rose-500 transition-all hover:rotate-90 active:scale-90"
            title="Rotate 90°"
          >
            <RotateCw size={18} />
          </button>
        )}
        <button onClick={() => onRemove(id)} className="p-2 hover:bg-rose-500/10 rounded-full text-gray-400 hover:text-rose-500 transition-all hover:scale-110 active:scale-90">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}

function LazyMergedPageThumbnail({ pdfDoc, pageNum }: { pdfDoc: any, pageNum: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pdfDoc || src) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        renderGridThumbnail(pdfDoc, pageNum).then(setSrc)
        observer.disconnect()
      }
    }, { rootMargin: '400px' })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [pdfDoc, pageNum, src])

  if (src) {
    return <img src={src} className="w-full h-full object-cover animate-in fade-in duration-300" alt={`Merged page ${pageNum}`} />
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-gray-50 dark:bg-zinc-900 flex items-center justify-center">
      <Loader2 size={18} className="animate-spin text-gray-300 dark:text-zinc-700" />
    </div>
  )
}

export default function MergeTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { setPipelineFile, consumePipelineFile } = usePipeline()
  const { objectUrl, createUrl, clearUrls } = useObjectURL()
  const [files, setFiles] = useState<PdfFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [customFileName, setCustomFileName] = useState('paperknife-merged')
  const [progress, setProgress] = useState(0)
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false)
  const [hasRestorableWorkspace, setHasRestorableWorkspace] = useState(false)
  const [mergedDraft, setMergedDraft] = useState<MergedPdfDraft | null>(null)
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())
  const isNative = Capacitor.isNativePlatform()

  useEffect(() => {
    return () => {
      mergedDraft?.pdfDoc?.destroy?.()
    }
  }, [mergedDraft])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      if (pipelined.type && pipelined.type !== 'application/pdf') {
        toast.error('The file from the previous tool is not a PDF and cannot be used here.')
        return
      }
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFiles([file])
      toast.success(`Imported ${file.name} from pipeline`)
    }
  }, [])

  useEffect(() => {
    getWorkspace('merge').then(ws => {
      if (ws && ws.files.length > 0 && files.length === 0) {
        setHasRestorableWorkspace(true)
      }
    })
  }, [])

  useEffect(() => {
    if (files.length > 0) {
      const save = async () => {
        const fileDatas = await Promise.all(files.map(async f => ({
          name: f.file.name,
          buffer: new Uint8Array(await f.file.arrayBuffer()),
          settings: { rotation: f.rotation, password: f.password }
        })))
        saveWorkspace('merge', fileDatas)
      }
      save()
    } else if (files.length === 0 && !hasRestorableWorkspace) {
      clearWorkspace('merge')
    }
  }, [files])

  const restoreWorkspace = async () => {
    const ws = await getWorkspace('merge')
    if (!ws) return

    const restoredFiles = ws.files.map(f => ({
      id: Math.random().toString(36).substr(2, 9),
      file: new File([f.buffer as any], f.name, { type: 'application/pdf' }),
      thumbnail: undefined,
      pageCount: 0,
      isLocked: false,
      rotation: f.settings.rotation || 0,
      password: f.settings.password
    }))

    setFiles(restoredFiles)
    setHasRestorableWorkspace(false)
    toast.success('Workspace restored successfully!')

    for (const pdfFile of restoredFiles) {
      getPdfMetaData(pdfFile.file).then(meta => {
        setFiles(prev => prev.map(f => f.id === pdfFile.id ? { 
          ...f, 
          thumbnail: meta.thumbnail,
          pageCount: meta.pageCount,
          isLocked: meta.isLocked
        } : f))
      })
    }
  }

  const handleFiles = async (selectedFiles: FileList | File[]) => {
    const newFiles = Array.from(selectedFiles).filter(f => f.type === 'application/pdf').map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      thumbnail: undefined,
      pageCount: 0,
      isLocked: false,
      rotation: 0
    }))
    
    if (newFiles.length === 0) return

    setFiles(prev => [...prev, ...newFiles])
    clearUrls()
    
    // Clear input value to allow selecting the same file again
    if (fileInputRef.current) fileInputRef.current.value = ''

    for (const pdfFile of newFiles) {
      getPdfMetaData(pdfFile.file).then(meta => {
        setFiles(prev => prev.map(f => f.id === pdfFile.id ? { 
          ...f, 
          thumbnail: meta.thumbnail,
          pageCount: meta.pageCount,
          isLocked: meta.isLocked
        } : f))
      })
    }
  }

  const handleUnlock = async (id: string, pass: string) => {
    const pdfFile = files.find(f => f.id === id)
    if (!pdfFile) return

    const result = await unlockPdf(pdfFile.file, pass)
    if (result.success) {
      setFiles(prev => prev.map(f => f.id === id ? {
        ...f,
        isLocked: false,
        thumbnail: result.thumbnail,
        pageCount: result.pageCount,
        password: pass
      } : f))
    } else {
      toast.error('Incorrect password for ' + pdfFile.file.name)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (mergedDraft || objectUrl || isProcessing) return
    setIsDraggingGlobal(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingGlobal(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingGlobal(false)
    if (mergedDraft || objectUrl || isProcessing) return
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      setFiles((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id)
        const newIndex = items.findIndex((i) => i.id === over?.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    clearUrls()
  }

  const rotateFile = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, rotation: (f.rotation + 90) % 360 } : f))
    clearUrls()
  }

  const totalPages = files.reduce((sum, f) => sum + f.pageCount, 0)
  const hasLockedFiles = files.some(f => f.isLocked)
  const canMerge = files.length >= 2 && !hasLockedFiles

  const completeExport = (payload: Uint8Array) => {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = createUrl(blob)
    const fileName = `${customFileName || 'merged'}.pdf`

    setPipelineFile({
      buffer: bytes,
      name: fileName,
      type: 'application/pdf'
    })

    addActivity({
      name: fileName,
      tool: 'Merge',
      size: blob.size,
      resultUrl: url
    })

    setIsProcessing(false)
    setProgress(100)
    clearWorkspace('merge')
    toast.success(`Exported ${selectedPages.size} selected page${selectedPages.size === 1 ? '' : 's'}`)
  }

  const mergePDFs = async () => {
    if (!canMerge) return

    setIsProcessing(true)
    setProgress(0)
    
    try {
      const worker = new Worker(new URL('../../utils/pdfWorker.ts', import.meta.url), { type: 'module' })
      const fileDatas = []
      for (const f of files) {
        fileDatas.push({
          buffer: await f.file.arrayBuffer(),
          rotation: f.rotation,
          password: f.password
        })
      }

      worker.postMessage({ type: 'MERGE_PDFS', payload: { files: fileDatas } })

      worker.onmessage = async (e) => {
        const { type, payload } = e.data
        if (type === 'PROGRESS') {
          setProgress(payload)
        } else if (type === 'SUCCESS') {
          worker.terminate()
          try {
            const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
            const mergedFile = new File([bytes as BlobPart], `${customFileName || 'merged'}.pdf`, { type: 'application/pdf' })
            const pdfDoc = await loadPdfDocument(mergedFile)
            const allPages = new Set<number>()
            for (let page = 1; page <= pdfDoc.numPages; page++) allPages.add(page)
            setMergedDraft({ buffer: bytes, pdfDoc, pageCount: pdfDoc.numPages })
            setSelectedPages(allPages)
            setProgress(100)
            toast.success('Merge complete. Choose the pages to export.')
          } catch (error) {
            console.error(error)
            toast.error('Merged PDF could not be prepared for page selection.')
          } finally {
            setIsProcessing(false)
          }
        } else if (type === 'ERROR') {
          toast.error(payload)
          setIsProcessing(false)
          worker.terminate()
        }
      }
      worker.onerror = () => {
        toast.error('The merge worker stopped unexpectedly.')
        setIsProcessing(false)
        worker.terminate()
      }
    } catch (error: any) {
      toast.error('An error occurred.')
      setIsProcessing(false)
    }
  }

  const toggleMergedPage = (pageNum: number) => {
    setSelectedPages(current => {
      const next = new Set(current)
      if (next.has(pageNum)) next.delete(pageNum)
      else next.add(pageNum)
      return next
    })
    clearUrls()
  }

  const exportSelectedPages = () => {
    if (!mergedDraft || selectedPages.size === 0) return
    setIsProcessing(true)
    setProgress(0)

    if (selectedPages.size === mergedDraft.pageCount) {
      completeExport(mergedDraft.buffer)
      return
    }

    const worker = new Worker(new URL('../../utils/pdfWorker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({
      type: 'SPLIT_PDF',
      payload: {
        buffer: mergedDraft.buffer,
        selectedPages: Array.from(selectedPages),
        mode: 'single',
        customFileName
      }
    })
    worker.onmessage = (e) => {
      const { type, payload } = e.data
      if (type === 'SUCCESS') {
        worker.terminate()
        completeExport(payload)
      } else if (type === 'ERROR') {
        toast.error(payload)
        setIsProcessing(false)
        worker.terminate()
      }
    }
    worker.onerror = () => {
      toast.error('The page export worker stopped unexpectedly.')
      setIsProcessing(false)
      worker.terminate()
    }
  }

  const backToFiles = () => {
    setMergedDraft(null)
    setSelectedPages(new Set())
    setProgress(0)
    clearUrls()
  }

  const startOver = () => {
    setFiles([])
    setMergedDraft(null)
    setSelectedPages(new Set())
    setIsProcessing(false)
    setProgress(0)
    clearUrls()
    clearWorkspace('merge')
  }

  const MergeButton = () => (
    <button 
      onClick={mergePDFs}
      disabled={isProcessing || !canMerge}
      className={`w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20`}
    >
      {isProcessing ? <><Loader2 className="animate-spin" /> {progress}%</> : <>Merge & Choose Pages <ArrowRight size={18} /></>}
    </button>
  )

  const ExportButton = () => (
    <button
      onClick={exportSelectedPages}
      disabled={isProcessing || selectedPages.size === 0}
      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20"
    >
      {isProcessing ? <><Loader2 className="animate-spin" /> Exporting...</> : <>Export {selectedPages.size} Page{selectedPages.size === 1 ? '' : 's'} <ArrowRight size={18} /></>}
    </button>
  )

  return (
    <NativeToolLayout
      title="Merge PDF"
      description="Combine PDFs, review every merged page, and export only the pages you want."
      actions={!objectUrl && (mergedDraft ? <ExportButton /> : files.length > 0 && <MergeButton />)}
    >
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1"
      >
        {isDraggingGlobal && (
          <div className="fixed inset-0 z-[100] bg-rose-500/90 backdrop-blur-xl flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-300">
            <div className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center mb-8 animate-bounce">
              <Plus size={64} strokeWidth={3} />
            </div>
            <h2 className="text-4xl md:text-6xl font-black mb-4 text-center">Drop to Add</h2>
          </div>
        )}

        {hasRestorableWorkspace && (
          <div className="mb-8 p-6 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 rounded-[2rem] flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-top duration-500 shadow-sm">
             <div className="flex items-center gap-4 text-left">
                <div className="w-12 h-12 bg-pk-surface dark:bg-zinc-900 rounded-2xl flex items-center justify-center text-indigo-500 shadow-sm">
                   <RefreshCw size={24} className="animate-spin-slow" />
                </div>
                <div>
                   <h4 className="font-black text-sm dark:text-white uppercase tracking-tight">Unfinished Work Found</h4>
                   <p className="text-xs text-gray-500 dark:text-zinc-400 font-medium">We saved your previous file list. Want to restore it?</p>
                </div>
             </div>
             <div className="flex gap-2 w-full md:w-auto">
                <button 
                  onClick={restoreWorkspace}
                  className="flex-1 md:flex-none px-6 py-3 bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-500/20 active:scale-95"
                >
                  Restore
                </button>
                <button 
                  onClick={() => { clearWorkspace('merge'); setHasRestorableWorkspace(false); }}
                  className="flex-1 md:flex-none px-6 py-3 bg-white dark:bg-zinc-800 text-gray-400 hover:text-rose-500 rounded-xl text-xs font-black uppercase tracking-widest transition-colors active:scale-95"
                >
                  Discard
                </button>
             </div>
          </div>
        )}

        <div className="space-y-6">
          {!objectUrl && (mergedDraft ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="bg-pk-surface dark:bg-zinc-900 p-5 rounded-3xl border border-pk-border dark:border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={backToFiles}
                    disabled={isProcessing}
                    className="w-10 h-10 rounded-xl bg-pk-surface-muted dark:bg-zinc-950 text-gray-500 hover:text-rose-500 flex items-center justify-center transition-colors disabled:opacity-50"
                    aria-label="Back to PDF files"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h3 className="font-black text-sm dark:text-white">Review merged pages</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      Tap any page to include or exclude it
                    </p>
                  </div>
                </div>
                <div className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-xl text-xs font-black">
                  {selectedPages.size} of {mergedDraft.pageCount} selected
                </div>
              </div>

              <div className="bg-pk-surface dark:bg-zinc-900 p-5 md:p-6 rounded-[2rem] border border-pk-border dark:border-white/5 shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <h4 className="font-black uppercase tracking-widest text-[10px] text-gray-400">Pages to export</h4>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">Pages remain in their original merged order.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const allPages = new Set<number>()
                        for (let page = 1; page <= mergedDraft.pageCount; page++) allPages.add(page)
                        setSelectedPages(allPages)
                      }}
                      className="px-3 py-2 rounded-xl text-[9px] font-black uppercase text-rose-500 bg-rose-50 dark:bg-rose-900/20"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setSelectedPages(new Set())}
                      className="px-3 py-2 rounded-xl text-[9px] font-black uppercase text-gray-400 bg-pk-surface-muted dark:bg-zinc-950"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[60vh] overflow-y-auto p-1 scrollbar-hide">
                  {Array.from({ length: mergedDraft.pageCount }).map((_, index) => {
                    const pageNum = index + 1
                    const isSelected = selectedPages.has(pageNum)
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => toggleMergedPage(pageNum)}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Exclude' : 'Include'} merged page ${pageNum}`}
                        className={`relative group aspect-[3/4] rounded-xl overflow-hidden border-2 text-left transition-all ${isSelected ? 'border-rose-500 scale-[1.02]' : 'border-transparent opacity-50 grayscale hover:opacity-80 hover:border-gray-200 dark:hover:border-zinc-800'}`}
                      >
                        <LazyMergedPageThumbnail pdfDoc={mergedDraft.pdfDoc} pageNum={pageNum} />
                        <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected ? 'bg-rose-500/10 opacity-100' : 'bg-black/20 opacity-0 group-hover:opacity-100'}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${isSelected ? 'bg-rose-500 text-white scale-100' : 'bg-white text-gray-400 scale-75'}`}>
                            {isSelected ? <Check size={20} strokeWidth={3} /> : <Plus size={20} />}
                          </div>
                        </div>
                        <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded text-[9px] font-black text-white">
                          PAGE {pageNum}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-pk-surface dark:bg-zinc-900 p-6 rounded-3xl border border-pk-border dark:border-white/5 shadow-sm space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Output Filename</label>
                  <input
                    type="text"
                    value={customFileName}
                    onChange={(e) => setCustomFileName(e.target.value)}
                    className="w-full bg-pk-surface-muted dark:bg-zinc-950 rounded-xl px-4 py-3 outline-none font-bold text-sm border border-transparent focus:border-rose-500 transition-colors dark:text-white"
                  />
                </div>
                {selectedPages.size === 0 && (
                  <p className="text-xs font-bold text-rose-500">Select at least one page to export.</p>
                )}
              </div>
            </div>
          ) : files.length > 0 ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {files.length} Files • {totalPages} Pages
                </p>
                <button onClick={startOver} className="text-[10px] font-black uppercase text-rose-500/60 hover:text-rose-500 transition-colors font-bold">Clear All</button>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={files.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {files.map((file) => (
                      <SortableItem key={file.id} id={file.id} file={file} onRemove={removeFile} onRotate={rotateFile} onUnlock={handleUnlock} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl text-gray-400 font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:border-rose-500 hover:text-rose-500 transition-all"
              >
                <Plus size={16} /> Add More Files
              </button>

              {!objectUrl && (
                <div className="p-6 bg-pk-surface dark:bg-zinc-900 rounded-3xl border border-pk-border dark:border-white/5 shadow-sm">
                   <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Output Filename</label>
                   <input 
                      type="text" 
                      value={customFileName}
                      onChange={(e) => setCustomFileName(e.target.value)}
                      className="w-full bg-pk-surface-muted dark:bg-zinc-950 rounded-xl px-4 py-3 outline-none font-bold text-sm border border-transparent focus:border-rose-500 transition-colors dark:text-white"
                   />
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className="w-full border-4 border-dashed border-pk-border dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group"
            >
               <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-inner">
                  <Upload size={32} />
               </div>
               <h3 className="text-xl font-bold dark:text-white mb-2">Select PDF Files</h3>
               <p className="text-sm text-gray-400 font-medium">Tap to browse or drag and drop here</p>
            </button>
          ))}

          {isProcessing && !mergedDraft && !isNative && (
             <div className="mt-8 space-y-4">
                <div className="w-full bg-gray-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                   <div className="bg-rose-500 h-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Processing on Device...</p>
             </div>
          )}

          {objectUrl && (
            <div className="animate-in zoom-in duration-300">
              <SuccessState 
                message={`${selectedPages.size} Selected Page${selectedPages.size === 1 ? '' : 's'} Exported!`}
                downloadUrl={objectUrl}
                fileName={`${customFileName || 'merged'}.pdf`}
                onStartOver={startOver}
              />
            </div>
          )}
        </div>

        <input type="file" multiple accept=".pdf" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
        <PrivacyBadge />
      </div>
    </NativeToolLayout>
  )
}
