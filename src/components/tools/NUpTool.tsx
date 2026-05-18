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
import { LayoutGrid, Loader2, ArrowRight, X, Lock } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { toast } from 'sonner'

import { getPdfMetaData, loadPdfDocument, unlockPdf } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { useObjectURL } from '../../utils/useObjectURL'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

type NUpPdfData = {
  file: File
  pageCount: number
  isLocked: boolean
  pdfDoc?: any
  password?: string
  thumbnail?: string
  pageW?: number
  pageH?: number
}

type NUpPreset = 2 | 4 | 6

// rows, cols, and whether to swap sheet orientation (landscape for 2-up)
const LAYOUTS: Record<NUpPreset, { rows: number; cols: number; landscape: boolean; label: string }> = {
  2: { rows: 1, cols: 2, landscape: true, label: '2-up' },
  4: { rows: 2, cols: 2, landscape: false, label: '4-up' },
  6: { rows: 3, cols: 2, landscape: false, label: '6-up' },
}

interface PreviewProps {
  preset: NUpPreset
  margin: number
  gap: number
  pageW: number
  pageH: number
  thumbnail?: string
}

function LayoutPreview({ preset, margin, gap, pageW, pageH, thumbnail }: PreviewProps) {
  const { rows, cols, landscape } = LAYOUTS[preset]
  const sheetW = landscape ? Math.max(pageW, pageH) : pageW
  const sheetH = landscape ? Math.min(pageW, pageH) : pageH
  const cellW = (sheetW - margin * 2 - gap * (cols - 1)) / cols
  const cellH = (sheetH - margin * 2 - gap * (rows - 1)) / rows

  const cells: { x: number; y: number; w: number; h: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = margin + c * (cellW + gap)
      const cellY = margin + r * (cellH + gap)
      const scale = Math.min(cellW / pageW, cellH / pageH)
      const drawW = pageW * scale
      const drawH = pageH * scale
      cells.push({
        x: cellX + (cellW - drawW) / 2,
        y: cellY + (cellH - drawH) / 2,
        w: drawW,
        h: drawH,
      })
    }
  }

  return (
    <div className="w-full bg-gray-50 dark:bg-black rounded-2xl p-6 flex items-center justify-center">
      <svg
        viewBox={`0 0 ${sheetW} ${sheetH}`}
        className="max-h-[420px] w-auto h-auto max-w-full"
        style={{ aspectRatio: `${sheetW} / ${sheetH}` }}
      >
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="white" stroke="#d4d4d8" strokeWidth={Math.max(sheetW, sheetH) / 600} />
        {cells.map((cell, i) =>
          thumbnail ? (
            <image
              key={i}
              href={thumbnail}
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill="#e4e4e7" />
          )
        )}
      </svg>
    </div>
  )
}

export default function NUpTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { consumePipelineFile } = usePipeline()
  const { objectUrl, createUrl, clearUrls } = useObjectURL()
  const [pdfData, setPdfData] = useState<NUpPdfData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)
  const [preset, setPreset] = useState<NUpPreset>(2)
  const [margin, setMargin] = useState(18)
  const [gap, setGap] = useState(8)
  const [customFileName, setCustomFileName] = useState('paperknife-nup')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFile(file)
    }
  }, [])

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') return
    setIsLoadingMeta(true)
    try {
      const meta = await getPdfMetaData(file)
      if (meta.isLocked) {
        setPdfData({ file, pageCount: 0, isLocked: true })
      } else {
        const pdfDoc = await loadPdfDocument(file)
        const firstPage = await pdfDoc.getPage(1)
        const viewport = firstPage.getViewport({ scale: 1 })
        setPdfData({
          file,
          pageCount: meta.pageCount,
          isLocked: false,
          pdfDoc,
          thumbnail: meta.thumbnail,
          pageW: viewport.width,
          pageH: viewport.height,
        })
        setCustomFileName(`${file.name.replace(/\.pdf$/i, '')}-nup`)
      }
    } catch (err) {
      console.error(err)
      toast.error('Could not read PDF')
    } finally {
      setIsLoadingMeta(false)
      clearUrls()
    }
  }

  const handleUnlock = async () => {
    if (!pdfData || !unlockPassword) return
    setIsLoadingMeta(true)
    const result = await unlockPdf(pdfData.file, unlockPassword)
    if (result.success) {
      const firstPage = await result.pdfDoc.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      setPdfData({
        ...pdfData,
        isLocked: false,
        pageCount: result.pageCount,
        pdfDoc: result.pdfDoc,
        password: unlockPassword,
        thumbnail: result.thumbnail,
        pageW: viewport.width,
        pageH: viewport.height,
      })
      setCustomFileName(`${pdfData.file.name.replace(/\.pdf$/i, '')}-nup`)
    } else {
      toast.error('Incorrect password')
    }
    setIsLoadingMeta(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0])
    if (e.target) e.target.value = ''
  }

  const buildNUp = async () => {
    if (!pdfData) return
    setIsProcessing(true)
    setProgress(0)
    try {
      const buffer = await pdfData.file.arrayBuffer()
      const src = await PDFDocument.load(buffer, {
        password: pdfData.password || undefined,
        ignoreEncryption: true,
      } as any)

      const out = await PDFDocument.create()
      const { rows, cols, landscape } = LAYOUTS[preset]
      const N = rows * cols

      const firstPage = src.getPage(0)
      const srcW = firstPage.getWidth()
      const srcH = firstPage.getHeight()
      const sheetW = landscape ? Math.max(srcW, srcH) : srcW
      const sheetH = landscape ? Math.min(srcW, srcH) : srcH

      const cellW = (sheetW - margin * 2 - gap * (cols - 1)) / cols
      const cellH = (sheetH - margin * 2 - gap * (rows - 1)) / rows

      const totalSrc = src.getPageCount()
      const indices = src.getPageIndices()
      const embedded = await out.embedPages(indices.map(i => src.getPage(i)))

      const sheetCount = Math.ceil(totalSrc / N)

      for (let s = 0; s < sheetCount; s++) {
        const page = out.addPage([sheetW, sheetH])
        for (let slot = 0; slot < N; slot++) {
          const srcIdx = s * N + slot
          if (srcIdx >= totalSrc) break
          const emb = embedded[srcIdx]
          const eW = emb.width
          const eH = emb.height
          const scale = Math.min(cellW / eW, cellH / eH)
          const drawW = eW * scale
          const drawH = eH * scale

          const row = Math.floor(slot / cols)
          const col = slot % cols
          // PDF coordinate system has origin at bottom-left; we lay out from top-left visually.
          const cellX = margin + col * (cellW + gap)
          const cellYTop = sheetH - margin - row * (cellH + gap)
          const x = cellX + (cellW - drawW) / 2
          const y = cellYTop - cellH + (cellH - drawH) / 2

          page.drawPage(emb, { x, y, width: drawW, height: drawH })
        }
        setProgress(Math.round(((s + 1) / sheetCount) * 100))
      }

      const bytes = await out.save()
      const blob = new Blob([bytes as any], { type: 'application/pdf' })
      const url = createUrl(blob)
      addActivity({ name: `${customFileName || 'nup'}.pdf`, tool: 'N-Up', size: blob.size, resultUrl: url })
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to build N-up PDF')
    } finally {
      setIsProcessing(false)
    }
  }

  const ActionButton = () => (
    <button
      onClick={buildNUp}
      disabled={isProcessing}
      className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl flex items-center justify-center gap-3 shadow-lg shadow-rose-500/20"
    >
      {isProcessing ? (
        <>
          <Loader2 className="animate-spin" /> Working {progress}%
        </>
      ) : (
        <>
          Combine into {LAYOUTS[preset].label} <ArrowRight size={18} />
        </>
      )}
    </button>
  )

  return (
    <NativeToolLayout
      title="N-Up / Pages per Sheet"
      description="Place 2, 4, 6, or 9 source pages onto a single sheet — ideal for printing handouts. Everything stays on your device."
      actions={pdfData && !pdfData.isLocked && !objectUrl && <ActionButton />}
    >
      <input type="file" accept=".pdf" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />

      {!pdfData ? (
        <button
          onClick={() => !isLoadingMeta && fileInputRef.current?.click()}
          className={`w-full border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group ${isLoadingMeta ? 'opacity-50 cursor-wait' : ''}`}
        >
          {isLoadingMeta ? (
            <div className="flex flex-col items-center">
              <Loader2 size={48} className="text-rose-500 animate-spin mb-4" />
              <h3 className="text-xl font-bold mb-2">Analyzing PDF...</h3>
            </div>
          ) : (
            <>
              <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                <LayoutGrid size={32} />
              </div>
              <h3 className="text-xl font-bold dark:text-white mb-2">Select PDF File</h3>
              <p className="text-sm text-gray-400 font-medium">Tap to combine pages</p>
            </>
          )}
        </button>
      ) : pdfData.isLocked ? (
        <div className="max-w-md mx-auto relative z-[100]">
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-[2.5rem] border border-gray-100 dark:border-white/5 shadow-2xl text-center">
            <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <Lock size={32} />
            </div>
            <h3 className="text-2xl font-bold mb-2 dark:text-white">Protected File</h3>
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Enter Password"
              className="w-full bg-gray-50 dark:bg-black rounded-2xl px-6 py-4 border border-transparent focus:border-rose-500 outline-none font-bold text-center mb-4 dark:text-white"
              autoFocus
            />
            <button
              onClick={handleUnlock}
              disabled={!unlockPassword || isLoadingMeta}
              className="w-full bg-rose-500 text-white p-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-50"
            >
              Unlock PDF
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-6 shadow-sm">
            <div className="w-12 h-16 bg-gray-50 dark:bg-black rounded-xl overflow-hidden shrink-0 border border-gray-100 dark:border-zinc-800 flex items-center justify-center text-rose-500 shadow-inner">
              {pdfData.thumbnail ? <img src={pdfData.thumbnail} className="w-full h-full object-cover" /> : <LayoutGrid size={24} />}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h3 className="font-bold text-sm truncate dark:text-white">{pdfData.file.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black">
                {pdfData.pageCount} Pages • {(pdfData.file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            <button onClick={() => { setPdfData(null); clearUrls() }} className="p-2 text-gray-400 hover:text-rose-500 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-in fade-in duration-500 items-start">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm">
                <h4 className="font-black uppercase tracking-widest text-[10px] text-gray-400 px-2 mb-4">Layout</h4>
                <div className="grid grid-cols-3 gap-3">
                  {(Object.keys(LAYOUTS) as unknown as NUpPreset[]).map((rawKey) => {
                    const key = Number(rawKey) as NUpPreset
                    const layout = LAYOUTS[key]
                    const selected = preset === key
                    return (
                      <button
                        key={key}
                        onClick={() => { setPreset(key); clearUrls() }}
                        className={`aspect-square rounded-2xl p-3 border-2 transition-all flex flex-col items-center justify-center gap-2 ${selected ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20' : 'border-transparent bg-gray-50 dark:bg-black hover:border-gray-200 dark:hover:border-zinc-800'}`}
                      >
                        <div
                          className="grid gap-1 w-12 h-12"
                          style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}
                        >
                          {Array.from({ length: layout.rows * layout.cols }).map((_, i) => (
                            <div key={i} className={`rounded-sm ${selected ? 'bg-rose-400' : 'bg-gray-300 dark:bg-zinc-700'}`} />
                          ))}
                        </div>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${selected ? 'text-rose-500' : 'text-gray-400'}`}>
                          {layout.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-4 px-2">
                  <h4 className="font-black uppercase tracking-widest text-[10px] text-gray-400">Live Preview</h4>
                  <span className="text-[10px] text-gray-400 font-bold">
                    {pdfData.pageCount} → {Math.ceil(pdfData.pageCount / preset)} sheet{Math.ceil(pdfData.pageCount / preset) === 1 ? '' : 's'}
                  </span>
                </div>
                {pdfData.pageW && pdfData.pageH ? (
                  <LayoutPreview
                    preset={preset}
                    margin={margin}
                    gap={gap}
                    pageW={pdfData.pageW}
                    pageH={pdfData.pageH}
                    thumbnail={pdfData.thumbnail}
                  />
                ) : (
                  <div className="w-full h-64 flex items-center justify-center text-gray-400">
                    <Loader2 className="animate-spin" />
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 shadow-sm lg:sticky lg:top-24">
                <div className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Output Filename</label>
                    <input
                      type="text"
                      value={customFileName}
                      onChange={(e) => setCustomFileName(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Sheet Margin ({margin}pt)</label>
                    <input
                      type="range"
                      min={0}
                      max={72}
                      value={margin}
                      onChange={(e) => { setMargin(Number(e.target.value)); clearUrls() }}
                      className="w-full accent-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Gap Between Cells ({gap}pt)</label>
                    <input
                      type="range"
                      min={0}
                      max={48}
                      value={gap}
                      onChange={(e) => { setGap(Number(e.target.value)); clearUrls() }}
                      className="w-full accent-rose-500"
                    />
                  </div>

                  {objectUrl && (
                    <div className="pt-5 border-t border-gray-100 dark:border-white/5">
                      <SuccessState
                        message="N-up Successful!"
                        downloadUrl={objectUrl}
                        fileName={`${customFileName || 'nup'}.pdf`}
                        onStartOver={() => { clearUrls(); setPdfData(null); setIsProcessing(false) }}
                      />
                    </div>
                  )}

                  <button onClick={() => { setPdfData(null); clearUrls() }} className="w-full py-2 text-[10px] font-black uppercase text-gray-300 hover:text-rose-500 transition-colors">
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
