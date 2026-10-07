import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { Tool, ToolCategory } from '../types'
import { PaperKnifeLogo } from './Logo'

const categories: (ToolCategory | 'All')[] = ['All', 'Edit', 'Secure', 'Convert', 'Optimize']

const categoryColors: Record<ToolCategory, { bg: string, text: string, icon: string, border: string }> = {
  Edit: { bg: 'bg-rose-50 dark:bg-rose-900/10', text: 'text-rose-600 dark:text-rose-400', icon: 'text-rose-500', border: 'border-rose-200/60 dark:border-rose-900/20' },
  Secure: { bg: 'bg-indigo-50 dark:bg-indigo-900/10', text: 'text-indigo-600 dark:text-indigo-400', icon: 'text-indigo-500', border: 'border-indigo-200/60 dark:border-indigo-900/20' },
  Convert: { bg: 'bg-emerald-50 dark:bg-emerald-900/10', text: 'text-emerald-600 dark:text-emerald-400', icon: 'text-emerald-500', border: 'border-emerald-200/60 dark:border-emerald-900/20' },
  Optimize: { bg: 'bg-amber-50 dark:bg-amber-900/10', text: 'text-amber-600 dark:text-amber-400', icon: 'text-amber-500', border: 'border-amber-200/60 dark:border-amber-900/20' },
}

const categoryPills: Record<ToolCategory | 'All', string> = {
  All: 'bg-stone-900 dark:bg-white text-white dark:text-black border-transparent',
  Edit: 'bg-rose-500 text-white border-transparent',
  Secure: 'bg-indigo-500 text-white border-transparent',
  Convert: 'bg-emerald-500 text-white border-transparent',
  Optimize: 'bg-amber-500 text-white border-transparent',
}

export default function AndroidToolsView({ tools }: { tools: Tool[] }) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'All'>('All')

  const availableTools = useMemo(
    () => tools.filter(tool => tool.implemented !== false && tool.path),
    [tools],
  )

  const filteredTools = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return availableTools.filter(tool => {
      const matchesSearch = !normalizedQuery ||
        tool.title.toLowerCase().includes(normalizedQuery) ||
        tool.desc.toLowerCase().includes(normalizedQuery)
      const matchesCategory = activeCategory === 'All' || tool.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [availableTools, searchQuery, activeCategory])

  const groupedTools = useMemo(() => {
    return filteredTools.reduce((groups, tool) => {
      const categoryTools = groups[tool.category] || []
      categoryTools.push(tool)
      groups[tool.category] = categoryTools
      return groups
    }, {} as Partial<Record<ToolCategory, Tool[]>>)
  }, [filteredTools])

  return (
    <div className="min-h-screen pk-shell pb-32">
      <header className="px-5 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-5 sticky top-0 pk-header-bar z-40">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-stone-900 dark:text-white">All Tools</h1>
            <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-stone-400 dark:text-zinc-500">Same engines as PaperKnife Web</p>
          </div>
          <span className="mb-1 shrink-0 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-[9px] font-black uppercase tracking-widest">
            {availableTools.length} Active
          </span>
        </div>

        <div className="relative group">
          <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-stone-400 group-focus-within:text-rose-500 transition-colors">
            <Search size={20} />
          </div>
          <input
            type="search"
            placeholder="Search for a tool..."
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            className="w-full pk-input-field rounded-[1.75rem] py-4 pl-14 pr-6 text-base font-bold placeholder:text-stone-400 focus:border-rose-400 ring-2 ring-transparent focus:ring-rose-500/10 transition-all outline-none shadow-pk-sm"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide mt-4 pb-1" aria-label="Tool categories">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`shrink-0 px-4 py-2 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all ${activeCategory === category ? categoryPills[category] : 'bg-pk-surface dark:bg-zinc-900 border-pk-border dark:border-white/5 text-stone-400 dark:text-zinc-500'}`}
            >
              {category}
            </button>
          ))}
        </div>
      </header>

      <main className="px-4 space-y-8">
        {categories.slice(1).map(category => {
          const categoryTools = groupedTools[category as ToolCategory]
          if (!categoryTools?.length) return null

          return (
            <section key={category} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="px-2 mb-4 flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-stone-500 dark:text-zinc-400">
                  {category} Tools
                </h3>
                <span className="text-[9px] font-black text-stone-300 dark:text-zinc-700">{categoryTools.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {categoryTools.map(tool => {
                  const colors = categoryColors[tool.category]
                  const Icon = tool.icon
                  return (
                    <button
                      key={tool.path || tool.title}
                      onClick={() => tool.path && navigate(tool.path)}
                      className="relative flex items-center gap-4 p-4 pk-surface-card rounded-2xl active:bg-pk-surface-muted dark:active:bg-zinc-950 transition-all"
                    >
                      <div className={`w-12 h-12 ${colors.bg} ${colors.icon} rounded-xl flex items-center justify-center shrink-0`}>
                        <Icon size={24} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-stone-900 dark:text-white truncate">{tool.title}</h4>
                          {tool.isNew && <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[7px] font-black uppercase tracking-wider">New</span>}
                        </div>
                        <p className="text-xs text-stone-500 dark:text-zinc-400 truncate mt-0.5">{tool.desc}</p>
                      </div>
                      <ChevronRight size={18} className="text-stone-300 dark:text-zinc-600" />
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}

        {filteredTools.length === 0 && (
          <section className="py-20 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-3xl bg-stone-100 dark:bg-zinc-900 text-stone-300 dark:text-zinc-700 flex items-center justify-center">
              <Search size={28} />
            </div>
            <h2 className="font-black text-lg dark:text-white">No tools matched</h2>
            <p className="text-xs text-stone-500 dark:text-zinc-500 mt-2">Try another search or category.</p>
            <button onClick={() => { setSearchQuery(''); setActiveCategory('All') }} className="mt-5 text-[10px] font-black uppercase tracking-widest text-rose-500">Reset Catalog</button>
          </section>
        )}
      </main>

      <footer className="text-center py-12 opacity-20">
        <PaperKnifeLogo size={24} iconColor="#F43F5E" partColor="currentColor" className="mx-auto mb-4" />
        <p className="text-[9px] font-black uppercase tracking-[0.5em]">PaperKnife Version 1.4.0</p>
      </footer>
    </div>
  )
}
