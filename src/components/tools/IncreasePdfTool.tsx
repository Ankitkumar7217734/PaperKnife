/**
 * PaperKnife - The Swiss Army Knife for PDFs
 * Copyright (C) 2026 potatameister
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useRef, useEffect } from 'react'
import { Expand, Loader2, X, ArrowRight, FileIcon } from 'lucide-react'
import { toast } from 'sonner'

import { getPdfMetaData } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
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

/**
 * Increases a PDF to an exact byte size by appending a padding comment
 * after the final %%EOF marker. Conforming PDF readers locate the
 * cross-reference table from the trailer, so trailing bytes are ignored
 * and the document keeps opening exactly as before.
 */
function buildPaddedPdf(original: Uint8Array, targetBytes: number): Uint8Array {
  const out = new Uint8Array(targetBytes)
  out.set(original, 0)
  const marker = '\n%PaperKnife-padding '
  let i = original.length
  for (let c = 0; c < marker.length && i < targetBytes; c++, i++) {
    out[i] = marker.charCodeAt(c)
  }
  // Fill the remainder with the printable 'A' byte (0x41) so the trailing
  // block stays inside a single, well-formed PDF comment line.
  while (i < targetBytes) {
    out[i] = 0x41
    i++
  }
  return out
}

export default function IncreasePdfTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { consumePipelineFile } = usePipeline()
  const { objectUrl, createUrl, clearUrls } = useObjectURL()

  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null)
  const [thumbnail, setThumbnail] = useState<string>('')
  const [pageCount, setPageCount] = useState(0)
  const [isLocked, setIsLocked] = useState(false)

  const [targetValue, setTargetValue] = useState<string>('')
  const [unit, setUnit] = useState<Unit>('MB')
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      if (pipelined.type && pipelined.type !== 'application/pdf') {
        toast.error('The file from the previous tool is not a PDF and cannot be used here.')
        return
      }
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFile(file)
    }
  }, [])

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Please pick a PDF file')
      return
    }
    clearUrls()
    const buffer = new Uint8Array(await file.arrayBuffer())
    setSourceFile(file)
    setSourceBytes(buffer)
    setThumbnail('')
    setPageCount(0)
    setIsLocked(false)

    // Suggest a target a little above the current size.
    const suggestedKb = Math.ceil(file.size / 1024) + 100
    if (suggestedKb >= 1024) {
      setUnit('MB')
      setTargetValue(String(Math.ceil(suggestedKb / 1024) + 1))
    } else {
      setUnit('KB')
      setTargetValue(String(suggestedKb))
    }

    if (fileInputRef.current) fileInputRef.current.value = ''

    getPdfMetaData(file).then(meta => {
      setPageCount(meta.pageCount)
      setIsLocked(meta.isLocked)
      setThumbnail(meta.thumbnail)
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0])
  }

  const closeFile = () => {
    setSourceFile(null)
    setSourceBytes(null)
    setThumbnail('')
    setPageCount(0)
    setIsLocked(false)
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
      toast.error(`Target must be larger than the current size (${humanSize(currentBytes)}). Use Compress PDF to shrink.`)
      return
    }

    setIsProcessing(true)
    try {
      const padded = buildPaddedPdf(sourceBytes, targetBytes)
      const blob = new Blob([padded as BlobPart], { type: 'application/pdf' })
      const url = createUrl(blob)
      const finalName = sourceFile.name.replace(/\.pdf$/i, '') + `-${humanSize(targetBytes).replace(/\s+/g, '')}.pdf`
      addActivity({ name: finalName, tool: 'Increase PDF Size', size: blob.size, resultUrl: url })
      toast.success('PDF size increased')
    } catch (err) {
      console.error(err)
      toast.error('Failed to increase PDF size')
    } finally {
      setIsProcessing(false)
    }
  }

  const finalName = sourceFile
    ? sourceFile.name.replace(/\.pdf$/i, '') + `-${humanSize(targetBytes).replace(/\s+/g, '')}.pdf`
    : 'document.pdf'

  const ActionButton = () => (
    <button
      onClick={handleIncrease}
      disabled={isProcessing || isLocked || !isValidTarget}
      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20"
    >
      {isProcessing ? (
        <><Loader2 className="animate-spin" /> Working...</>
      ) : (
        <>Increase PDF <ArrowRight size={18} /></>
      )}
    </button>
  )

  return (
    <NativeToolLayout
      title="Increase PDF Size"
      description="Pad a PDF up to an exact file size (KB or MB) to meet a minimum upload requirement. The document opens exactly as before and everything runs on your device."
      actions={sourceFile && !objectUrl && <ActionButton />}
    >
      <input
        type="file"
        accept=".pdf"
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
            <Expand size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select PDF</h3>
          <p className="text-sm text-gray-400 font-medium">Tap to pick a document</p>
        </button>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-[1.5rem] border border-gray-100 dark:border-white/5 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-16 bg-gray-50 dark:bg-black rounded-lg overflow-hidden shrink-0 border border-gray-100 dark:border-zinc-800 flex items-center justify-center">
              {thumbnail ? <img src={thumbnail} className="w-full h-full object-cover" /> : <FileIcon className="text-gray-300" size={16} />}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-black truncate dark:text-white">{sourceFile.name}</p>
              {isLocked ? (
                <p className="text-[10px] text-rose-500 font-bold uppercase tracking-tighter">Locked — unlock it first</p>
              ) : (
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{humanSize(currentBytes)}{pageCount > 0 ? ` • ${pageCount} Pages` : ''}</p>
              )}
            </div>
            <button onClick={closeFile} className="p-2 text-gray-400 hover:text-rose-500 transition-colors">
              <X size={18} />
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
                  placeholder="e.g. 2"
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
                Target must be larger than the current size. To make a PDF smaller, use Compress PDF.
              </p>
            )}

            {objectUrl && (
              <div className="pt-5 border-t border-gray-100 dark:border-white/5">
                <SuccessState
                  message={`PDF padded to ${humanSize(targetBytes)}`}
                  downloadUrl={objectUrl}
                  fileName={finalName}
                  onStartOver={closeFile}
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
