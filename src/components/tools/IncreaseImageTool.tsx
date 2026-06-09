/**
 * PaperKnife - The Swiss Army Knife for PDFs
 * Copyright (C) 2026 potatameister
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useRef } from 'react'
import { ImageUp, Loader2, X, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

import { addActivity } from '../../utils/recentActivity'
import { useObjectURL } from '../../utils/useObjectURL'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

type Unit = 'KB' | 'MB'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function extOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || 'jpg'
  return ext
}

/**
 * Increases an image file to an exact byte size by appending neutral
 * trailing padding. The pixel data is preserved untouched — image
 * decoders ignore bytes after the end-of-image marker, so the picture
 * looks identical while the file reaches the requested size.
 */
function buildPaddedImage(original: Uint8Array, targetBytes: number): Uint8Array {
  const out = new Uint8Array(targetBytes)
  out.set(original, 0)
  // Remaining bytes are already zero-initialised, which decoders ignore.
  return out
}

export default function IncreaseImageTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { objectUrl, createUrl, clearUrls } = useObjectURL()

  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)

  const [targetValue, setTargetValue] = useState<string>('')
  const [unit, setUnit] = useState<Unit>('KB')
  const [isProcessing, setIsProcessing] = useState(false)

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image (JPG, PNG, WebP, or GIF)')
      return
    }
    clearUrls()
    const buffer = new Uint8Array(await file.arrayBuffer())
    setSourceFile(file)
    setSourceBytes(buffer)

    const reader = new FileReader()
    reader.onload = (e) => setSourcePreview(e.target?.result as string)
    reader.readAsDataURL(file)

    // Suggest a target a little above the current size.
    const suggestedKb = Math.ceil(file.size / 1024) + 50
    if (suggestedKb >= 1024) {
      setUnit('MB')
      setTargetValue(String(Math.ceil(suggestedKb / 1024) + 1))
    } else {
      setUnit('KB')
      setTargetValue(String(suggestedKb))
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0])
  }

  const closeFile = () => {
    setSourceFile(null)
    setSourceBytes(null)
    setSourcePreview(null)
    setTargetValue('')
    setIsProcessing(false)
    clearUrls()
  }

  const currentBytes = sourceFile?.size || 0
  const numericTarget = parseFloat(targetValue) || 0
  const targetBytes = Math.round(numericTarget * (unit === 'MB' ? 1024 * 1024 : 1024))
  const addedBytes = targetBytes - currentBytes
  const isValidTarget = numericTarget > 0 && targetBytes > currentBytes

  const handleIncrease = () => {
    if (!sourceFile || !sourceBytes) return
    if (numericTarget <= 0) {
      toast.error('Enter a target size first')
      return
    }
    if (targetBytes <= currentBytes) {
      toast.error(`Target must be larger than the current size (${humanSize(currentBytes)}). Use Compress Image to shrink.`)
      return
    }

    setIsProcessing(true)
    try {
      const padded = buildPaddedImage(sourceBytes, targetBytes)
      const blob = new Blob([padded as BlobPart], { type: sourceFile.type })
      const url = createUrl(blob)
      const ext = extOf(sourceFile.name)
      const finalName = `${sourceFile.name.replace(/\.[^.]+$/, '')}-${humanSize(targetBytes).replace(/\s+/g, '')}.${ext}`
      addActivity({ name: finalName, tool: 'Increase Image Size', size: blob.size, resultUrl: url })
      toast.success('Image size increased')
    } catch (err) {
      console.error(err)
      toast.error('Failed to increase image size')
    } finally {
      setIsProcessing(false)
    }
  }

  const finalName = sourceFile
    ? `${sourceFile.name.replace(/\.[^.]+$/, '')}-${humanSize(targetBytes).replace(/\s+/g, '')}.${extOf(sourceFile.name)}`
    : 'image.jpg'

  const ActionButton = () => (
    <button
      onClick={handleIncrease}
      disabled={isProcessing || !isValidTarget}
      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20"
    >
      {isProcessing ? (
        <><Loader2 className="animate-spin" /> Working...</>
      ) : (
        <>Increase Image <ArrowRight size={18} /></>
      )}
    </button>
  )

  return (
    <NativeToolLayout
      title="Increase Image Size"
      description="Pad an image up to an exact file size (KB or MB) to meet a minimum upload requirement. The picture stays identical and everything runs on your device."
      actions={sourceFile && !objectUrl && <ActionButton />}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileSelect}
      />

      {!sourceFile ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group"
        >
          <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-inner">
            <ImageUp size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select Image</h3>
          <p className="text-sm text-gray-400 font-medium">JPG, PNG, WebP, or GIF</p>
        </button>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-6 shadow-sm">
            <div className="w-12 h-12 bg-gray-50 dark:bg-black rounded-xl overflow-hidden shrink-0 border border-gray-100 dark:border-zinc-800 flex items-center justify-center text-rose-500 shadow-inner">
              {sourcePreview ? <img src={sourcePreview} className="w-full h-full object-cover" /> : <ImageUp size={20} />}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h3 className="font-bold text-sm truncate dark:text-white">{sourceFile.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black">Current • {humanSize(currentBytes)}</p>
            </div>
            <button onClick={closeFile} className="p-2 text-gray-400 hover:text-rose-500 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-6 md:p-8 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm space-y-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 px-1">Target File Size</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  inputMode="decimal"
                  placeholder="e.g. 500"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="flex-1 bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-lg dark:text-white"
                />
                <div className="grid grid-cols-2 gap-1 bg-gray-50 dark:bg-black p-1 rounded-xl">
                  {(['KB', 'MB'] as Unit[]).map((u) => (
                    <button
                      key={u}
                      onClick={() => setUnit(u)}
                      className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${unit === u ? 'bg-white dark:bg-zinc-800 text-rose-500 shadow-sm' : 'text-gray-400'}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">Current</p>
                <p className="text-sm font-black dark:text-white">{humanSize(currentBytes)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">Target</p>
                <p className="text-sm font-black dark:text-white">{numericTarget > 0 ? humanSize(targetBytes) : '—'}</p>
              </div>
              <div className="bg-gray-50 dark:bg-black rounded-xl p-4">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1">Added</p>
                <p className={`text-sm font-black ${isValidTarget ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {numericTarget > 0 ? (addedBytes > 0 ? `+${humanSize(addedBytes)}` : 'Too small') : '—'}
                </p>
              </div>
            </div>

            {numericTarget > 0 && !isValidTarget && (
              <p className="text-[11px] text-rose-500 font-bold px-1">
                Target must be larger than the current size. To make an image smaller, use Compress Image.
              </p>
            )}

            {objectUrl && (
              <div className="pt-5 border-t border-gray-100 dark:border-white/5">
                <SuccessState
                  message={`Image padded to ${humanSize(targetBytes)}`}
                  downloadUrl={objectUrl}
                  fileName={finalName}
                  onStartOver={closeFile}
                  showPreview={false}
                />
              </div>
            )}
          </div>
        </div>
      )}
      <PrivacyBadge />
    </NativeToolLayout>
  )
}
