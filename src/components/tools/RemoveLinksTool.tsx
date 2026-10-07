import { useEffect, useState } from 'react'
import { Link2Off, Lock, Loader2, X, Globe, ShieldCheck } from 'lucide-react'
import { PDFDocument, PDFDict, PDFName, PDFObject, PDFRef } from 'pdf-lib'
import { toast } from 'sonner'

import { getPdfMetaData, unlockPdf } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { hapticSelection } from '../../utils/haptics'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'
import { NativeToolLayout } from './shared/NativeToolLayout'

type LinkScope = 'all' | 'web'

type PdfFileState = { file: File, pageCount: number, isLocked: boolean, thumbnail?: string, password?: string }

type LinkScan = { total: number, web: number, internal: number }

const SUBTYPE_KEY = PDFName.of('Subtype')
const ANNOTS_KEY = PDFName.of('Annots')
const ACTION_KEY = PDFName.of('A')
const ACTION_TYPE_KEY = PDFName.of('S')
const LINK_SUBTYPE = '/Link'
const URI_ACTION = '/URI'

const resolveDict = (obj: PDFObject | undefined, context: any): PDFDict | undefined => {
  if (!obj) return undefined
  if (obj instanceof PDFRef) return context.lookupMaybe(obj, PDFDict)
  return obj instanceof PDFDict ? obj : undefined
}

const isName = (obj: PDFObject | undefined, value: string): boolean =>
  obj instanceof PDFName && obj.asString() === value

// Reads one annotation dict and classifies it. Web links carry a /URI action;
// everything else (GoTo, Named, /Dest, dead annotations) is internal or inert.
const classifyLinkAnnot = (dict: PDFDict | undefined): 'web' | 'other' | null => {
  if (!dict) return null
  const subtype = dict.lookup(SUBTYPE_KEY)
  if (!isName(subtype, LINK_SUBTYPE)) return null
  const action = dict.lookup(ACTION_KEY)
  return action instanceof PDFDict && isName(action.lookup(ACTION_TYPE_KEY), URI_ACTION) ? 'web' : 'other'
}

// Non-destructive scan used for the pre-upload report.
const scanLinks = async (buffer: ArrayBuffer): Promise<LinkScan> => {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true } as any)
  const scan: LinkScan = { total: 0, web: 0, internal: 0 }
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const kind = classifyLinkAnnot(resolveDict(annots.get(i), pdfDoc.context))
      if (!kind) continue
      scan.total++
      if (kind === 'web') scan.web++
      else scan.internal++
    }
  }
  return scan
}

// Rebuilds each page's /Annots array without the matching link annotations.
// Widget (form) and other annotation types are always preserved.
const stripLinks = async (buffer: ArrayBuffer, scope: LinkScope): Promise<{ removed: number, webRemoved: number, pagesAffected: number, bytes: Uint8Array }> => {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true } as any)
  const context = pdfDoc.context
  let removed = 0
  let webRemoved = 0
  let pagesAffected = 0

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots()
    if (!annots || annots.size() === 0) continue

    const kept: PDFObject[] = []
    let pageRemoved = 0
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i)
      const kind = classifyLinkAnnot(resolveDict(raw, context))
      if (kind && (scope === 'all' || kind === 'web')) {
        pageRemoved++
        if (kind === 'web') webRemoved++
      } else {
        kept.push(raw)
      }
    }

    if (pageRemoved > 0) {
      removed += pageRemoved
      pagesAffected++
      if (kept.length === 0) page.node.delete(ANNOTS_KEY)
      else page.node.set(ANNOTS_KEY, context.obj(kept))
    }
  }

  const bytes = await pdfDoc.save()
  return { removed, webRemoved, pagesAffected, bytes }
}

export default function RemoveLinksTool() {
  const { consumePipelineFile } = usePipeline()
  const [pdfData, setPdfData] = useState<PdfFileState | null>(null)
  const [scan, setScan] = useState<LinkScan | null>(null)
  const [scope, setScope] = useState<LinkScope>('all')
  const [isProcessing, setIsProcessing] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [resultSummary, setResultSummary] = useState<{ removed: number, webRemoved: number, pagesAffected: number } | null>(null)
  const [customFileName, setCustomFileName] = useState('paperknife-no-links')
  const [unlockPassword, setUnlockPassword] = useState('')

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFile(file)
    }
  }, [])

  const analyzeFile = async (file: File) => {
    const meta = await getPdfMetaData(file)
    if (meta.isLocked) {
      setPdfData({ file, pageCount: 0, isLocked: true })
      setScan(null)
      return
    }
    const arrayBuffer = await file.arrayBuffer()
    const linkScan = await scanLinks(arrayBuffer)
    setPdfData({ file, pageCount: meta.pageCount, isLocked: false, thumbnail: meta.thumbnail })
    setScan(linkScan)
    setDownloadUrl(null)
    setResultSummary(null)
    setCustomFileName(`${file.name.replace(/\.pdf$/i, '')}-no-links`)
  }

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please select a PDF file.')
      return
    }
    setIsProcessing(true)
    try {
      await analyzeFile(file)
    } catch (err: any) {
      console.error(err)
      toast.error('Could not read this PDF.')
      setPdfData(null)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUnlock = async () => {
    if (!pdfData || !unlockPassword) return
    setIsProcessing(true)
    const result = await unlockPdf(pdfData.file, unlockPassword)
    if (result.success) {
      try {
        await analyzeFile(pdfData.file)
        setPdfData(prev => prev ? { ...prev, isLocked: false, password: unlockPassword } : prev)
      } catch {
        toast.error('Could not analyze this PDF.')
      }
    } else {
      toast.error('Incorrect password')
    }
    setIsProcessing(false)
  }

  const processPdf = async () => {
    if (!pdfData) return
    setIsProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 100))
    try {
      const arrayBuffer = await pdfData.file.arrayBuffer()
      const { removed, webRemoved, pagesAffected, bytes } = await stripLinks(arrayBuffer, scope)

      if (removed === 0) {
        setScan({ total: 0, web: 0, internal: 0 })
        toast.info('No matching links were found in this document.')
        return
      }

      const blob = new Blob([bytes as any], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setResultSummary({ removed, webRemoved, pagesAffected })
      setDownloadUrl(url)
      addActivity({ name: `${customFileName}.pdf`, tool: 'Remove Links', size: blob.size, resultUrl: url })
    } catch (error: any) {
      console.error(error)
      toast.error(`Error: ${error.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const startOver = () => {
    setDownloadUrl(null)
    setResultSummary(null)
    setScan(null)
    setPdfData(null)
    setUnlockPassword('')
  }

  const ActionButton = () => (
    <button onClick={processPdf} disabled={isProcessing} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-sky-500/20 py-4 rounded-2xl text-sm md:p-6 md:rounded-3xl md:text-xl">
      {isProcessing ? <Loader2 className="animate-spin" /> : <Link2Off size={20} />} Remove {scope === 'all' ? 'All' : 'Web'} Links
    </button>
  )

  const scopeButtonClass = (active: boolean) =>
    `flex flex-col items-start gap-1 p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${active
      ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
      : 'border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-900 hover:border-sky-200 dark:hover:border-sky-900'}`

  return (
    <NativeToolLayout
      title="Remove Links"
      description="Strip hidden hyperlinks from your PDF so tapping a page never opens a browser."
      actions={pdfData && !pdfData.isLocked && scan && scan.total > 0 && !downloadUrl && <ActionButton />}
    >
      <input type="file" accept=".pdf,application/pdf" id="remove-links-file" className="hidden" onChange={(e) => { e.target.files?.[0] && handleFile(e.target.files[0]); e.target.value = '' }} />

      {!pdfData ? (
        <label htmlFor="remove-links-file" className={`block border-4 border-dashed border-pk-border dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-sky-50 dark:hover:bg-sky-900/10 transition-all cursor-pointer group ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="w-20 h-20 bg-sky-50 dark:bg-sky-900/20 text-sky-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform"><Link2Off size={32} /></div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select PDF</h3>
          <p className="text-sm text-gray-400">{isProcessing ? 'Scanning for links…' : 'Tap to pick a document'}</p>
        </label>
      ) : pdfData.isLocked ? (
        <div className="max-w-md mx-auto relative z-[100]">
          <div className="bg-pk-surface dark:bg-zinc-900 p-8 rounded-[2.5rem] border border-pk-border dark:border-white/5 text-center shadow-2xl">
            <div className="w-16 h-16 bg-sky-100 dark:bg-sky-900/30 text-sky-500 rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} /></div>
            <h3 className="text-2xl font-bold mb-2 dark:text-white">Protected File</h3>
            <input type="password" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} placeholder="Password" className="w-full bg-pk-surface-muted dark:bg-zinc-950 rounded-2xl px-6 py-4 border border-transparent focus:border-sky-500 outline-none font-bold text-center mb-4 dark:text-white" />
            <button onClick={handleUnlock} disabled={!unlockPassword || isProcessing} className="w-full bg-sky-500 text-white p-4 rounded-2xl font-black uppercase text-xs">Unlock</button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-pk-surface dark:bg-zinc-900 p-6 rounded-3xl border border-pk-border dark:border-white/5 flex items-center gap-6 shadow-sm">
            <div className="w-12 h-16 bg-pk-surface-muted dark:bg-zinc-950 rounded-xl overflow-hidden shrink-0 border border-pk-border dark:border-zinc-800 flex items-center justify-center text-sky-500 shadow-inner">{pdfData.thumbnail ? <img src={pdfData.thumbnail} className="w-full h-full object-cover" /> : <Link2Off size={24} />}</div>
            <div className="flex-1 min-w-0 text-left">
              <h3 className="font-bold text-sm truncate dark:text-white">{pdfData.file.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">{pdfData.pageCount} Pages • {(pdfData.file.size / (1024*1024)).toFixed(1)} MB</p>
            </div>
            <button onClick={startOver} className="p-2 text-gray-400 hover:text-sky-500 transition-colors"><X size={20} /></button>
          </div>

          {scan && scan.total === 0 ? (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 rounded-3xl p-8 text-center">
              <div className="w-14 h-14 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-4"><ShieldCheck size={28} /></div>
              <h4 className="font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-tight mb-1">No Links Found</h4>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-bold">This document has no clickable link annotations — nothing to remove.</p>
            </div>
          ) : scan ? (
            <>
              <div className="bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/20 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-sky-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-sky-500/20">
                  <Link2Off size={20} />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-black text-sky-500 uppercase tracking-tight leading-none mb-1">{scan.total} Link{scan.total === 1 ? '' : 's'} Detected</h4>
                  <p className="text-xs text-sky-500/70 font-bold">{scan.web} web • {scan.internal} internal — choose what to strip below.</p>
                </div>
              </div>

              <div className="bg-pk-surface dark:bg-zinc-900 p-8 rounded-[2rem] border border-pk-border dark:border-white/5 shadow-sm space-y-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-3">What to remove</label>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <button onClick={() => { setScope('all'); hapticSelection(); setDownloadUrl(null) }} className={scopeButtonClass(scope === 'all')}>
                      <span className="flex items-center gap-2 font-black text-sm text-gray-900 dark:text-white"><Link2Off size={16} className="text-sky-500" /> All Links</span>
                      <span className="text-[10px] text-gray-400 font-bold">Web links + internal page jumps</span>
                    </button>
                    <button onClick={() => { setScope('web'); hapticSelection(); setDownloadUrl(null) }} className={scopeButtonClass(scope === 'web')}>
                      <span className="flex items-center gap-2 font-black text-sm text-gray-900 dark:text-white"><Globe size={16} className="text-sky-500" /> Web Links Only</span>
                      <span className="text-[10px] text-gray-400 font-bold">Keeps table-of-contents style links</span>
                    </button>
                  </div>
                </div>

                <div><label className="block text-[10px] font-black uppercase text-gray-400 mb-3">Output Filename</label><input type="text" value={customFileName} onChange={(e) => setCustomFileName(e.target.value)} className="w-full bg-pk-surface-muted dark:bg-zinc-950 rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white" /></div>

                {downloadUrl && resultSummary ? (
                  <SuccessState
                    message={`Removed ${resultSummary.removed} link${resultSummary.removed === 1 ? '' : 's'} (${resultSummary.webRemoved} web) from ${resultSummary.pagesAffected} page${resultSummary.pagesAffected === 1 ? '' : 's'}!`}
                    downloadUrl={downloadUrl}
                    fileName={`${customFileName}.pdf`}
                    onStartOver={startOver}
                  />
                ) : null}

                <button onClick={startOver} className="w-full py-2 text-[10px] font-black uppercase text-gray-300 hover:text-sky-500 transition-colors">Close File</button>
              </div>
            </>
          ) : null}
        </div>
      )}
      <PrivacyBadge />
    </NativeToolLayout>
  )
}
