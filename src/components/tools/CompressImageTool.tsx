/**
 * PaperKnife - The Swiss Army Knife for PDFs
 * Copyright (C) 2026 potatameister
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { ImageDown, Loader2, X, ArrowRight, Link2, Unlink2 } from 'lucide-react'
import { toast } from 'sonner'

import { addActivity } from '../../utils/recentActivity'
import { useObjectURL } from '../../utils/useObjectURL'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

type Format = 'auto' | 'jpeg' | 'png' | 'webp'

const SIZE_PRESETS = [
  { label: 'Passport (600×600)', w: 600, h: 600 },
  { label: 'LinkedIn (400×400)', w: 400, h: 400 },
  { label: 'HD (1920×1080)', w: 1920, h: 1080 },
  { label: 'Web (1280×720)', w: 1280, h: 720 },
] as const

function resolveMime(format: Format, sourceMime: string): string {
  if (format === 'auto') {
    if (sourceMime.includes('png')) return 'image/png'
    if (sourceMime.includes('webp')) return 'image/webp'
    return 'image/jpeg'
  }
  return `image/${format}`
}

function extForMime(mime: string): string {
  const ext = mime.split('/')[1]
  return ext === 'jpeg' ? 'jpg' : ext
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function CompressImageTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { objectUrl, createUrl, clearUrls } = useObjectURL()

  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)

  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [keepAspect, setKeepAspect] = useState(true)
  const [quality, setQuality] = useState(80)
  const [format, setFormat] = useState<Format>('auto')
  const [customFileName, setCustomFileName] = useState('compressed-image')

  const [outBlob, setOutBlob] = useState<Blob | null>(null)
  const [outPreview, setOutPreview] = useState<string | null>(null)
  const [isComputing, setIsComputing] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)

  const aspectRatio = useMemo(
    () => (sourceImg ? sourceImg.naturalWidth / sourceImg.naturalHeight : 1),
    [sourceImg]
  )

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image (JPG, PNG, or WebP)')
      return
    }
    clearUrls()
    setSourceFile(file)
    setOutBlob(null)
    if (outPreview) {
      URL.revokeObjectURL(outPreview)
      setOutPreview(null)
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setSourcePreview(dataUrl)
      const img = new Image()
      img.onload = () => {
        setSourceImg(img)
        setWidth(img.naturalWidth)
        setHeight(img.naturalHeight)
        setCustomFileName(`${file.name.replace(/\.[^.]+$/, '')}-compressed`)
      }
      img.onerror = () => toast.error('Could not decode image')
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0])
    if (e.target) e.target.value = ''
  }

  const onWidthChange = (raw: string) => {
    const w = Math.max(1, parseInt(raw, 10) || 0)
    setWidth(w)
    if (keepAspect && sourceImg) setHeight(Math.max(1, Math.round(w / aspectRatio)))
  }

  const onHeightChange = (raw: string) => {
    const h = Math.max(1, parseInt(raw, 10) || 0)
    setHeight(h)
    if (keepAspect && sourceImg) setWidth(Math.max(1, Math.round(h * aspectRatio)))
  }

  const applyPreset = (w: number, h: number) => {
    setKeepAspect(false)
    setWidth(w)
    setHeight(h)
  }

  const resetToOriginal = () => {
    if (!sourceImg) return
    setWidth(sourceImg.naturalWidth)
    setHeight(sourceImg.naturalHeight)
  }

  // Real-time recompute when any knob changes
  useEffect(() => {
    if (!sourceImg || !sourceFile || width < 1 || height < 1) return
    setIsComputing(true)
    const t = setTimeout(async () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(sourceImg, 0, 0, width, height)
        const mime = resolveMime(format, sourceFile.type)
        const q = mime === 'image/png' ? undefined : quality / 100
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, mime, q)
        )
        if (blob) {
          setOutBlob(blob)
          setOutPreview((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return URL.createObjectURL(blob)
          })
        }
      } catch (err) {
        console.error(err)
      } finally {
        setIsComputing(false)
      }
    }, 150)
    return () => {
      clearTimeout(t)
    }
  }, [sourceImg, sourceFile, width, height, quality, format])

  useEffect(() => {
    return () => {
      if (outPreview) URL.revokeObjectURL(outPreview)
    }
  }, [])

  // Invalidate finalized download URL whenever the user changes a compression knob,
  // so they must re-click "Compress Image" to regenerate a fresh download for the
  // current settings rather than getting a stale snapshot.
  useEffect(() => {
    if (objectUrl) clearUrls()
  }, [width, height, quality, format])

  const finalize = async () => {
    if (!outBlob || !sourceFile) return
    setIsFinalizing(true)
    try {
      const mime = resolveMime(format, sourceFile.type)
      const ext = extForMime(mime)
      const finalName = `${customFileName || 'compressed'}.${ext}`
      const url = createUrl(outBlob)
      addActivity({ name: finalName, tool: 'Image Compress', size: outBlob.size, resultUrl: url })
    } finally {
      setIsFinalizing(false)
    }
  }

  const closeFile = () => {
    setSourceFile(null)
    setSourceImg(null)
    setSourcePreview(null)
    setOutBlob(null)
    if (outPreview) URL.revokeObjectURL(outPreview)
    setOutPreview(null)
    clearUrls()
  }

  const outMime = sourceFile ? resolveMime(format, sourceFile.type) : 'image/jpeg'
  const outExt = extForMime(outMime)
  const isPng = outMime === 'image/png'

  const sourceSize = sourceFile?.size || 0
  const outSize = outBlob?.size || 0
  const savings = sourceSize > 0 && outSize > 0 ? Math.round((1 - outSize / sourceSize) * 100) : 0
  const savingsColor = savings > 0 ? 'text-emerald-500' : 'text-rose-500'

  const ActionButton = () => (
    <button
      onClick={finalize}
      disabled={!outBlob || isComputing || isFinalizing}
      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20"
    >
      {isFinalizing ? (
        <>
          <Loader2 className="animate-spin" /> Working...
        </>
      ) : isComputing ? (
        <>
          <Loader2 className="animate-spin" /> Updating Preview...
        </>
      ) : (
        <>
          Compress Image <ArrowRight size={18} />
        </>
      )}
    </button>
  )

  return (
    <NativeToolLayout
      title="Compress & Resize Image"
      description="Shrink image file size and optionally change dimensions to meet upload requirements. All processing stays on your device."
      actions={sourceFile && !objectUrl && <ActionButton />}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileSelect}
      />

      {!sourceFile ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group"
        >
          <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
            <ImageDown size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select Image</h3>
          <p className="text-sm text-gray-400 font-medium">JPG, PNG, or WebP</p>
        </button>
      ) : (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-6 shadow-sm">
            <div className="w-12 h-12 bg-gray-50 dark:bg-black rounded-xl overflow-hidden shrink-0 border border-gray-100 dark:border-zinc-800 flex items-center justify-center text-rose-500 shadow-inner">
              {sourcePreview ? (
                <img src={sourcePreview} className="w-full h-full object-cover" />
              ) : (
                <ImageDown size={20} />
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h3 className="font-bold text-sm truncate dark:text-white">{sourceFile.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black">
                {sourceImg ? `${sourceImg.naturalWidth} × ${sourceImg.naturalHeight}` : '...'} • {humanSize(sourceFile.size)}
              </p>
            </div>
            <button onClick={closeFile} className="p-2 text-gray-400 hover:text-rose-500 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-in fade-in duration-500 items-start">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-4 px-2">
                  <h4 className="font-black uppercase tracking-widest text-[10px] text-gray-400">Live Preview</h4>
                  <span className="text-[10px] text-gray-400 font-bold uppercase">
                    {width} × {height} • {outExt.toUpperCase()}
                  </span>
                </div>
                <div className="bg-gray-50 dark:bg-black rounded-2xl p-6 flex items-center justify-center min-h-[260px] relative">
                  {outPreview ? (
                    <img
                      src={outPreview}
                      className={`max-h-[420px] max-w-full object-contain rounded transition-opacity duration-150 ${isComputing ? 'opacity-60' : 'opacity-100'}`}
                      alt="Preview"
                    />
                  ) : sourcePreview ? (
                    <img src={sourcePreview} className="max-h-[420px] max-w-full object-contain rounded opacity-60" alt="Original" />
                  ) : null}
                  {isComputing && (
                    <div className="absolute top-3 right-3 bg-black/70 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" /> Updating
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                    <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">Original</p>
                    <p className="text-sm font-black dark:text-white">{humanSize(sourceSize)}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                    <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">New</p>
                    <p className="text-sm font-black dark:text-white">{outSize > 0 ? humanSize(outSize) : '—'}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                    <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">Savings</p>
                    <p className={`text-sm font-black ${savingsColor}`}>{outSize > 0 ? `${savings}%` : '—'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm lg:sticky lg:top-24">
                <div className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">Dimensions</label>
                      <button
                        onClick={() => setKeepAspect((v) => !v)}
                        className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-colors ${keepAspect ? 'text-rose-500 bg-rose-50 dark:bg-rose-900/20' : 'text-gray-400 bg-gray-50 dark:bg-black'}`}
                        title={keepAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                      >
                        {keepAspect ? <Link2 size={11} /> : <Unlink2 size={11} />} Lock
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={width}
                        onChange={(e) => onWidthChange(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-black rounded-xl px-3 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white text-center"
                      />
                      <span className="text-[10px] font-black text-gray-400">×</span>
                      <input
                        type="number"
                        min={1}
                        value={height}
                        onChange={(e) => onHeightChange(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-black rounded-xl px-3 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white text-center"
                      />
                    </div>
                    <button
                      onClick={resetToOriginal}
                      className="mt-2 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-rose-500 transition-colors px-1"
                    >
                      Reset to original
                    </button>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 px-1">Size Presets</label>
                    <div className="grid grid-cols-2 gap-2">
                      {SIZE_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => applyPreset(p.w, p.h)}
                          className="text-[10px] font-black uppercase tracking-tight bg-gray-50 dark:bg-black hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-500 text-gray-500 py-2 px-2 rounded-xl transition-colors"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 px-1">
                      Quality ({quality}%) {isPng && <span className="text-gray-300 normal-case font-bold ml-1">— PNG is lossless</span>}
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                      disabled={isPng}
                      className="w-full accent-rose-500 disabled:opacity-40"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 px-1">Output Format</label>
                    <div className="grid grid-cols-4 gap-1 bg-gray-50 dark:bg-black p-1 rounded-xl">
                      {(['auto', 'jpeg', 'png', 'webp'] as Format[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFormat(f)}
                          className={`py-2 rounded-lg text-[9px] font-black uppercase transition-all ${format === f ? 'bg-white dark:bg-zinc-800 text-rose-500 shadow-sm' : 'text-gray-400'}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 px-1">Output Filename</label>
                    <input
                      type="text"
                      value={customFileName}
                      onChange={(e) => setCustomFileName(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white"
                    />
                  </div>

                  {objectUrl && (
                    <div className="pt-5 border-t border-gray-100 dark:border-white/5">
                      <SuccessState
                        message="Image Compressed!"
                        downloadUrl={objectUrl}
                        fileName={`${customFileName || 'compressed'}.${outExt}`}
                        onStartOver={closeFile}
                        showPreview={false}
                      />
                    </div>
                  )}

                  <button onClick={closeFile} className="w-full py-2 text-[10px] font-black uppercase text-gray-300 hover:text-rose-500 transition-colors">
                    Close File
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <PrivacyBadge />
    </NativeToolLayout>
  )
}
