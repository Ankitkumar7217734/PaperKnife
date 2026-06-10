/**
 * PaperKnife - Professional Web Dashboard
 * A desktop-optimized, sidebar-driven interface.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Search as SearchIcon,
  ChevronRight as ChevronRightIcon,
  Sparkles as SparklesIcon,
  UploadCloud as DropHintIcon,
  History as RecentIcon
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Tool, ToolCategory } from '../types'
import { getRecentActivity } from '../utils/recentActivity'

const categoryColors: Record<ToolCategory, { bg: string, text: string, border: string, hover: string, glow: string }> = {
  Edit: { 
    bg: 'bg-rose-50 dark:bg-rose-900/20', 
    text: 'text-rose-500', 
    border: 'border-rose-100 dark:border-rose-900/30',
    hover: 'group-hover:bg-rose-500',
    glow: 'dark:hover:shadow-rose-900/20'
  },
  Secure: { 
    bg: 'bg-indigo-50 dark:bg-indigo-900/20', 
    text: 'text-indigo-500', 
    border: 'border-indigo-100 dark:border-indigo-900/30',
    hover: 'group-hover:bg-indigo-500',
    glow: 'dark:hover:shadow-indigo-900/20'
  },
  Convert: { 
    bg: 'bg-emerald-50 dark:bg-emerald-900/20', 
    text: 'text-emerald-500', 
    border: 'border-emerald-100 dark:border-emerald-900/30',
    hover: 'group-hover:bg-emerald-500',
    glow: 'dark:hover:shadow-emerald-900/20'
  },
  Optimize: { 
    bg: 'bg-amber-50 dark:bg-amber-900/20', 
    text: 'text-amber-500', 
    border: 'border-amber-100 dark:border-amber-900/30',
    hover: 'group-hover:bg-amber-500',
    glow: 'dark:hover:shadow-amber-900/20'
  }
}

const ToolCard = ({ title, desc, icon: Icon, onClick, category, isNew }: Tool & { onClick?: () => void }) => {
  const colors = categoryColors[category]

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col p-4 md:p-6 rounded-2xl md:rounded-[2rem] bg-white dark:bg-zinc-900/40 border border-gray-100 dark:border-white/5 hover:border-rose-500/50 dark:hover:border-rose-500/50 transition-all duration-300 text-left hover:shadow-2xl hover:shadow-rose-500/5 hover:-translate-y-1"
    >
      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-5 ${colors.bg} ${colors.text} group-hover:bg-rose-500 group-hover:text-white transition-all duration-500`}>
        <Icon size={22} strokeWidth={2} />
      </div>
      <h3 className="font-black text-gray-900 dark:text-white mb-1.5 md:mb-2 text-sm md:text-lg tracking-tight group-hover:text-rose-500 transition-colors">{title}</h3>
      <p className="text-xs md:text-sm text-gray-500 dark:text-zinc-400 font-medium leading-relaxed line-clamp-2">{desc}</p>

      {isNew && (
        <span className="absolute top-4 right-4 md:top-6 md:right-6 px-2 py-0.5 bg-rose-500 text-white text-[8px] font-black uppercase tracking-widest rounded-full shadow-sm group-hover:opacity-0 transition-opacity">New</span>
      )}
      <div className="absolute top-6 right-6 opacity-0 md:group-hover:opacity-100 transition-opacity text-rose-500">
        <ChevronRightIcon size={20} />
      </div>
    </button>
  )
}

const pillActive: Record<'All' | ToolCategory, string> = {
  All: 'bg-zinc-900 dark:bg-white text-white dark:text-black',
  Edit: 'bg-rose-500 text-white',
  Secure: 'bg-indigo-500 text-white',
  Convert: 'bg-emerald-500 text-white',
  Optimize: 'bg-amber-500 text-white'
}

const pillDot: Record<ToolCategory, string> = {
  Edit: 'bg-rose-500',
  Secure: 'bg-indigo-500',
  Convert: 'bg-emerald-500',
  Optimize: 'bg-amber-500'
}

export default function WebView({ tools }: { tools: Tool[] }) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'All'>('All')
  const [recentTools, setRecentTools] = useState<Tool[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  const categories: (ToolCategory | 'All')[] = ['All', 'Edit', 'Secure', 'Convert', 'Optimize']

  useEffect(() => {
    getRecentActivity(12).then(entries => {
      const seen: string[] = []
      entries.forEach(e => { if (!seen.includes(e.tool)) seen.push(e.tool) })
      setRecentTools(
        seen.map(name => tools.find(t => t.title === name))
            .filter((t): t is Tool => !!t)
            .slice(0, 4)
      )
    }).catch(() => {})
  }, [tools])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filteredTools = useMemo(() => {
    return tools.filter(tool => {
      const matchesSearch = tool.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           tool.desc.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory = activeCategory === 'All' || tool.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [tools, searchQuery, activeCategory])

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-black transition-colors duration-500">
      {/* Hero Section */}
      <section className="relative pt-10 md:pt-14 pb-8 md:pb-10 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(244,63,94,0.05),transparent_70%)] pointer-events-none" />

        <div className="max-w-6xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full text-[10px] font-black uppercase tracking-[0.2em] mb-5 border border-rose-100 dark:border-rose-900/30">
            <SparklesIcon size={14} /> Professional PDF Engine
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter dark:text-white mb-4 leading-[0.9]">
            Stop Uploading <br/>
            <span className="text-rose-500">Your Privacy.</span>
          </h1>

          <div className="max-w-2xl mx-auto relative group mt-6 md:mt-8">
            <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-gray-400 group-focus-within:text-rose-500 transition-colors">
              <SearchIcon size={20} />
            </div>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-gray-100 dark:border-white/5 rounded-[2rem] py-4 md:py-5 pl-14 pr-6 md:pr-16 shadow-2xl shadow-gray-200/50 dark:shadow-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all font-bold text-base md:text-lg dark:text-white"
            />
            <kbd className="hidden md:flex absolute right-5 inset-y-0 my-auto h-7 items-center px-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 text-[10px] font-black text-gray-300 dark:text-zinc-600 pointer-events-none">/</kbd>
          </div>
          <p className="hidden md:flex items-center justify-center gap-2 mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-zinc-600">
            <DropHintIcon size={14} className="text-rose-400" /> or drop a PDF anywhere on this page
          </p>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 pb-32">
        <div className="flex flex-col md:flex-row gap-8">
          
          {/* Main Grid */}
          <div className="flex-1">
            {recentTools.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3 px-1 text-gray-400 dark:text-zinc-600">
                  <RecentIcon size={12} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em]">Jump back in</span>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {recentTools.map(tool => (
                    <button
                      key={tool.title}
                      onClick={() => navigate(tool.path || '/')}
                      className="flex items-center gap-2.5 pl-2.5 pr-4 py-2 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-white/5 rounded-2xl shadow-sm hover:border-rose-500/50 hover:-translate-y-0.5 transition-all group"
                    >
                      <span className={`p-1.5 rounded-lg ${tool.bg} ${tool.color}`}><tool.icon size={14} /></span>
                      <span className="text-xs font-bold text-gray-700 dark:text-zinc-300 group-hover:text-rose-500 transition-colors">{tool.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center gap-2 px-5 md:px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all border ${activeCategory === cat ? `${pillActive[cat]} border-transparent shadow-lg` : 'bg-white dark:bg-zinc-900 text-gray-400 border-gray-100 dark:border-white/5 hover:border-rose-500'}`}
                  >
                    {cat !== 'All' && <span className={`w-1.5 h-1.5 rounded-full ${activeCategory === cat ? 'bg-white/80' : pillDot[cat]}`} />}
                    {cat}
                  </button>
                ))}
              </div>
              <p className="hidden md:block text-[10px] font-black text-gray-400 uppercase tracking-widest">{filteredTools.length} Modules Active</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {filteredTools.map((tool) => (
                <ToolCard 
                  key={tool.title} 
                  {...tool} 
                  onClick={() => navigate(tool.path || '/')}
                />
              ))}
            </div>

            {filteredTools.length === 0 && (
              <div className="py-32 text-center">
                <div className="w-20 h-20 bg-gray-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-300">
                  <SearchIcon size={32} />
                </div>
                <h3 className="text-2xl font-black dark:text-white mb-2">No tools matched.</h3>
                <p className="text-gray-500 dark:text-zinc-400 font-medium">Try searching for a different keyword or clear your filters.</p>
                <button onClick={() => { setSearchQuery(''); setActiveCategory('All'); }} className="mt-8 text-rose-500 font-black uppercase tracking-widest text-xs hover:underline underline-offset-8">Reset Dashboard</button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}