import { useEffect, useMemo, useRef, useState } from 'react'
import PdfImportDialog, { type ImportedElement } from './PdfImportDialog'

export type ElementType = 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'
type BlockFormat = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; highlight?: boolean }
type Block = { id: string; type: ElementType; text: string; quiet?: boolean; format?: BlockFormat }
type Snapshot = { id: string; name: string; createdAt: string; script: string }

const typeLabels: Record<ElementType, string> = { scene: 'Scene heading', action: 'Action', character: 'Character', dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition' }
const shortcuts: ElementType[] = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition']
const uid = () => crypto.randomUUID()
const makeBlock = (type: ElementType, text = ''): Block => ({ id: uid(), type, text })

function scriptToBlocks(script: string): Block[] {
  const paragraphs = script.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean)
  let previous: ElementType = 'action'
  const parsed = paragraphs.flatMap((text): Block[] => {
    const lines = text.split('\n')
    const first = lines[0].trim()
    const characterCue = /^[A-Z][A-Z0-9 ._'()\-]{1,35}$/.test(first) && !/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+/i.test(first)
    if (characterCue && lines.length > 1) {
      previous = 'dialogue'
      return [makeBlock('character', first), makeBlock('dialogue', lines.slice(1).join('\n').trim())]
    }
    let type: ElementType = 'action'
    if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+/i.test(text)) type = 'scene'
    else if (/^(FADE (IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT TO).*:?$/i.test(text)) type = 'transition'
    else if (/^\(.+\)$/.test(text)) type = 'parenthetical'
    else if (/^[A-Z][A-Z0-9 ._'()\-]{1,35}$/.test(text) && !text.includes('\n')) type = 'character'
    else if (previous === 'character' || previous === 'parenthetical') type = 'dialogue'
    previous = type
    return [makeBlock(type, text)]
  })
  return parsed.length ? parsed : [makeBlock('scene')]
}

const blocksToScript = (blocks: Block[]) => blocks.map((block) => block.text).join('\n\n')
const nextType = (type: ElementType): ElementType => type === 'character' || type === 'parenthetical' ? 'dialogue' : 'action'

function loadBlocks(initialScript: string) {
  try {
    const saved = JSON.parse(localStorage.getItem('mise:document') || 'null')
    if (Array.isArray(saved) && saved.every((block) => block && typeof block.id === 'string' && typeof block.text === 'string' && block.type in typeLabels)) return saved as Block[]
  } catch { /* Fall back to the portable screenplay text. */ }
  return scriptToBlocks(localStorage.getItem('mise:screenplay') || initialScript)
}

export default function ScreenplayEditor({ initialScript, title, onTitleChange }: { initialScript: string; title: string; onTitleChange: (title: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>(() => loadBlocks(initialScript))
  const [activeId, setActiveId] = useState('')
  const [saveState, setSaveState] = useState('Saved locally')
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<Snapshot[]>(() => JSON.parse(localStorage.getItem('mise:snapshots') || '[]'))
  const [draggedScene, setDraggedScene] = useState<number | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [draggingFile, setDraggingFile] = useState(false)
  const [utilityOpen, setUtilityOpen] = useState(() => localStorage.getItem('mise:utility-panel') !== 'closed')
  const [author, setAuthor] = useState(() => { const saved = localStorage.getItem('mise:author'); return saved === 'YOUR NAME' ? '' : saved || '' })
  const [email, setEmail] = useState(() => { const saved = localStorage.getItem('mise:email'); const legacy = localStorage.getItem('mise:contact'); return saved || (legacy && legacy !== 'your@email.com\n(555) 555-5555' ? legacy.split(/\r?\n/)[0] : '') || '' })
  const [phone, setPhone] = useState(() => { const saved = localStorage.getItem('mise:phone'); const legacy = localStorage.getItem('mise:contact'); return saved || (legacy && legacy !== 'your@email.com\n(555) 555-5555' ? legacy.split(/\r?\n/).slice(1).join(' ') : '') || '' })
  const fields = useRef(new Map<string, HTMLTextAreaElement>())
  const blocksRef = useRef(blocks)
  const history = useRef<Block[][]>([blocks])
  const historyIndex = useRef(0)
  const saveTimer = useRef<number | null>(null)

  const scenes = useMemo(() => blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.type === 'scene'), [blocks])
  const characters = useMemo(() => [...new Set(blocks.filter((block) => block.type === 'character').map((block) => block.text.replace(/\s*\(.+\)$/, '')).filter(Boolean))], [blocks])
  const sceneHeadings = useMemo(() => [...new Set(blocks.filter((block) => block.type === 'scene').map((block) => block.text).filter(Boolean))], [blocks])
  const activeIndex = Math.max(0, blocks.findIndex((block) => block.id === activeId))
  let activeSceneIndex = 0
  scenes.forEach((scene, index) => { if (scene.index <= activeIndex) activeSceneIndex = index })
  const words = blocks.reduce((total, block) => total + (block.text.match(/\b[\w'’-]+\b/g)?.length || 0), 0)
  const estimatedPages = Math.max(1, Math.ceil(words / 180))
  const matchCount = findText ? blocks.reduce((total, block) => total + (block.text.toLowerCase().split(findText.toLowerCase()).length - 1), 0) : 0

  const commit = (change: Block[] | ((current: Block[]) => Block[])) => {
    const next = typeof change === 'function' ? change(blocksRef.current) : change
    history.current = history.current.slice(0, historyIndex.current + 1)
    history.current.push(next)
    if (history.current.length > 150) history.current.shift()
    historyIndex.current = history.current.length - 1
    blocksRef.current = next
    setBlocks(next)
  }

  const replaceDocument = (script: string) => {
    const next = scriptToBlocks(script)
    blocksRef.current = next; setBlocks(next); history.current = [next]; historyIndex.current = 0; setActiveId(next[0]?.id || '')
  }
  const replaceWithElements = (elements: ImportedElement[]) => {
    const next = elements.filter((element) => element.text.trim()).map((element) => makeBlock(element.type, element.text.trim()))
    if (!next.length) return
    const backup: Snapshot = { id: uid(), name: 'Before PDF import', createdAt: new Date().toLocaleString(), script: blocksToScript(blocksRef.current) }
    setSnapshots((current) => { const updated = [backup, ...current]; localStorage.setItem('mise:snapshots', JSON.stringify(updated)); return updated })
    blocksRef.current = next; setBlocks(next); history.current = [next]; historyIndex.current = 0; setActiveId(next[0].id)
  }
  const openFile = (file: File) => {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) setPdfFile(file)
    else file.text().then(replaceDocument)
  }
  const undo = () => { if (historyIndex.current > 0) { historyIndex.current -= 1; blocksRef.current = history.current[historyIndex.current]; setBlocks(blocksRef.current) } }
  const redo = () => { if (historyIndex.current < history.current.length - 1) { historyIndex.current += 1; blocksRef.current = history.current[historyIndex.current]; setBlocks(blocksRef.current) } }

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    setSaveState('Saving…')
    saveTimer.current = window.setTimeout(() => { localStorage.setItem('mise:screenplay', blocksToScript(blocks)); localStorage.setItem('mise:document', JSON.stringify(blocks)); setSaveState('Saved locally') }, 400)
    fields.current.forEach((field) => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px` })
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [blocks])

  useEffect(() => {
    localStorage.setItem('mise:author', author)
    localStorage.setItem('mise:email', email)
    localStorage.setItem('mise:phone', phone)
    localStorage.removeItem('mise:contact')
  }, [author, email, phone])

  useEffect(() => { localStorage.setItem('mise:utility-panel', utilityOpen ? 'open' : 'closed') }, [utilityOpen])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPaletteOpen(false); setFindOpen(false); return }
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open) }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true) }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); toggleFormat('bold') }
      if (event.key.toLowerCase() === 'i') { event.preventDefault(); toggleFormat('italic') }
      if (event.key.toLowerCase() === 'u') { event.preventDefault(); toggleFormat('underline') }
      if (event.key.toLowerCase() === 'e') { event.preventDefault(); toggleFormat('highlight') }
      if (event.key.toLowerCase() === 'x' && event.shiftKey) { event.preventDefault(); toggleFormat('strike') }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  })

  const focusBlock = (id: string, caret: 'start' | 'end' = 'start') => requestAnimationFrame(() => {
    const field = fields.current.get(id)
    if (!field) return
    field.focus()
    const position = caret === 'end' ? field.value.length : 0
    field.setSelectionRange(position, position)
  })
  const changeType = (id: string, type: ElementType) => { commit((current) => current.map((block) => block.id === id ? { ...block, type, text: type === 'parenthetical' && !block.text ? '()' : block.text } : block)); focusBlock(id) }
  const toggleFormat = (key: keyof BlockFormat) => {
    if (!activeId) return
    commit((current) => current.map((block) => block.id === activeId ? { ...block, format: { ...block.format, [key]: !block.format?.[key] } } : block))
  }
  const clearFormat = () => { if (activeId) commit((current) => current.map((block) => block.id === activeId ? { ...block, format: {} } : block)) }
  const updateBlock = (id: string, text: string) => commit((current) => current.map((block) => block.id === id ? { ...block, quiet: false, text: block.type === 'scene' || block.type === 'character' || block.type === 'transition' ? text.toUpperCase() : text } : block))
  const insertAt = (index: number, type: ElementType, text = '', quiet = false) => { const block = { ...makeBlock(type, text), quiet }; commit((current) => [...current.slice(0, index), block, ...current.slice(index)]); setActiveId(block.id); focusBlock(block.id) }

  const handleKey = (event: React.KeyboardEvent<HTMLTextAreaElement>, block: Block, index: number) => {
    if ((event.metaKey || event.ctrlKey) && /^[1-6]$/.test(event.key)) { event.preventDefault(); changeType(block.id, shortcuts[Number(event.key) - 1]); return }
    if (event.key === 'Tab') { event.preventDefault(); changeType(block.id, shortcuts[(shortcuts.indexOf(block.type) + 1) % shortcuts.length]); return }
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault(); const previous = blocks[index - 1]; setActiveId(previous.id); focusBlock(previous.id, 'end'); return
    }
    if (event.key === 'ArrowDown' && index < blocks.length - 1) {
      event.preventDefault(); const next = blocks[index + 1]; setActiveId(next.id); focusBlock(next.id, 'start'); return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Backspace' && !block.text && blocks.length > 1) {
      event.preventDefault(); const previous = blocks[Math.max(0, index - 1)]; commit((current) => current.filter((item) => item.id !== block.id)); setActiveId(previous.id); focusBlock(previous.id)
    }
  }

  const insertFromPage = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    const clickedY = event.clientY
    const nextIndex = blocks.findIndex((block) => {
      const field = fields.current.get(block.id)
      if (!field) return false
      const bounds = field.getBoundingClientRect()
      return clickedY < bounds.top + bounds.height / 2
    })
    const index = nextIndex === -1 ? blocks.length : nextIndex
    const previousType = blocks[index - 1]?.type
    insertAt(index, previousType ? nextType(previousType) : 'action', '', true)
  }

  const moveScene = (from: number, to: number) => {
    if (from === to || !scenes[from] || !scenes[to]) return
    const preamble = blocks.slice(0, scenes[0].index)
    const chunks = scenes.map((scene, index) => blocks.slice(scene.index, scenes[index + 1]?.index ?? blocks.length))
    const [moving] = chunks.splice(from, 1); chunks.splice(to, 0, moving); commit([...preamble, ...chunks.flat()])
  }
  const replaceAll = () => { if (findText) { const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); commit((current) => current.map((block) => ({ ...block, text: block.text.replace(new RegExp(escaped, 'gi'), replaceText) }))) } }
  const downloadFountain = () => { const contact = [email, phone].filter(Boolean).join('\n    '); const titlePage = `Title: ${title || 'Untitled Screenplay'}\nCredit: Written by${author ? `\nAuthor: ${author}` : ''}${contact ? `\nContact: ${contact}` : ''}\n\n`; const blob = new Blob([titlePage + blocksToScript(blocks)], { type: 'text/plain;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${(title || 'untitled-screenplay').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.fountain`; link.click(); URL.revokeObjectURL(link.href) }
  const createSnapshot = () => { const next: Snapshot = { id: uid(), name: `Draft ${snapshots.length + 1}`, createdAt: new Date().toLocaleString(), script: blocksToScript(blocks) }; const updated = [next, ...snapshots]; setSnapshots(updated); localStorage.setItem('mise:snapshots', JSON.stringify(updated)); setSnapshotsOpen(true) }
  const runCommand = (command: string) => { setPaletteOpen(false); if (command === 'scene') insertAt(blocks.length, 'scene'); if (command === 'find') setFindOpen(true); if (command === 'snapshot') createSnapshot(); if (command === 'export') downloadFountain(); if (command === 'print') window.print() }
  const suggestions = blocks[activeIndex]?.type === 'character' ? characters : blocks[activeIndex]?.type === 'scene' ? sceneHeadings : []
  const currentText = blocks[activeIndex]?.text || ''
  const filteredSuggestions = suggestions.filter((value) => value !== currentText && value.startsWith(currentText)).slice(0, 5)
  const activeFormat = activeId ? blocks[activeIndex]?.format || {} : {}

  return <div className={`editor-layout ${utilityOpen ? 'utility-open' : 'utility-closed'} ${draggingFile ? 'dragging-file' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingFile(false) }} onDrop={(event) => { event.preventDefault(); setDraggingFile(false); const file = event.dataTransfer.files[0]; if (file) openFile(file) }}>
    <aside className="scene-nav"><div className="aside-title"><span>SCENES</span><b>{scenes.length}</b></div><nav>{scenes.map(({ block }, index) => <button key={block.id} draggable onDragStart={() => setDraggedScene(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedScene !== null) moveScene(draggedScene, index); setDraggedScene(null) }} className={index === activeSceneIndex ? 'active' : ''} onClick={() => { setActiveId(block.id); fields.current.get(block.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); focusBlock(block.id) }}><i>⠿</i><span>{String(index + 1).padStart(2, '0')}</span><p>{block.text || 'UNTITLED SCENE'}</p></button>)}</nav><button className="new-scene" onClick={() => insertAt(blocks.length, 'scene')}>＋ New scene</button><div className="nav-tip">Drag scenes to reorder them.</div></aside>
    <section className="desk"><div className="toolbar"><div className="editor-tools"><div className="format-select"><label>ELEMENT</label><select aria-label="Screenplay element" value={blocks[activeIndex]?.type || 'action'} onChange={(event) => activeId && changeType(activeId, event.target.value as ElementType)}>{Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></div><span className="toolbar-divider" /><div className="text-style-tools" aria-label="Text formatting"><button className={activeFormat.bold ? 'selected' : ''} onClick={() => toggleFormat('bold')} disabled={!activeId} aria-pressed={Boolean(activeFormat.bold)} title="Bold · ⌘B"><b>B</b></button><button className={activeFormat.italic ? 'selected' : ''} onClick={() => toggleFormat('italic')} disabled={!activeId} aria-pressed={Boolean(activeFormat.italic)} title="Italic · ⌘I"><i>I</i></button><button className={activeFormat.underline ? 'selected' : ''} onClick={() => toggleFormat('underline')} disabled={!activeId} aria-pressed={Boolean(activeFormat.underline)} title="Underline · ⌘U"><u>U</u></button><button className={activeFormat.strike ? 'selected' : ''} onClick={() => toggleFormat('strike')} disabled={!activeId} aria-pressed={Boolean(activeFormat.strike)} title="Strikethrough · ⌘⇧X"><s>S</s></button><button className={`highlight-tool ${activeFormat.highlight ? 'selected' : ''}`} onClick={() => toggleFormat('highlight')} disabled={!activeId} aria-pressed={Boolean(activeFormat.highlight)} title="Highlight line · ⌘E">H</button><button onClick={clearFormat} disabled={!activeId} title="Clear formatting">Tx</button></div><span className="toolbar-divider" /><div className="history-tools"><button onClick={undo} disabled={historyIndex.current <= 0} title="Undo">↶</button><button onClick={redo} disabled={historyIndex.current >= history.current.length - 1} title="Redo">↷</button></div></div><div className="document-tools"><label className="toolbar-import">Import<input type="file" accept=".pdf,.fountain,.txt,application/pdf,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) openFile(file); event.currentTarget.value = '' }} /></label><button onClick={() => setFindOpen(!findOpen)}>Find</button><button className="secondary-tool" onClick={createSnapshot}>Snapshot</button><button onClick={downloadFountain}>Export</button><button className="secondary-tool" onClick={() => window.print()}>Print / PDF</button><button className="command-button" onClick={() => setPaletteOpen(true)} title="Quick commands">⌘ K</button><button className="panel-toggle" onClick={() => setUtilityOpen((open) => !open)} aria-expanded={utilityOpen} aria-label={utilityOpen ? 'Close right panel' : 'Open right panel'}>Panel <span aria-hidden="true">{utilityOpen ? '▸' : '◂'}</span></button></div><div className="save-state"><span>{estimatedPages}p · {words} words</span><b>{saveState === 'Saving…' ? 'Saving…' : 'Saved'}</b></div></div>
      {findOpen && <div className="find-bar"><input autoFocus placeholder="Find" value={findText} onChange={(event) => setFindText(event.target.value)} /><span>{matchCount} matches</span><input placeholder="Replace with" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} /><button onClick={replaceAll}>Replace all</button><button onClick={() => setFindOpen(false)}>×</button></div>}
      <div className="page-stage"><article className="title-page"><div className="title-page-center"><textarea value={title} onChange={(event) => onTitleChange(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} aria-label="Title page screenplay title" rows={1} spellCheck={false} /><span>Written by</span><input value={author} onChange={(event) => setAuthor(event.target.value)} aria-label="Screenplay author" placeholder="Your name" /></div><div className="title-page-contact"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} aria-label="Screenplay contact email" placeholder="Email" /><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} aria-label="Screenplay contact phone" placeholder="Phone" /></div></article><article className="script-page" onMouseDown={insertFromPage}><span className="page-number">1.</span>{blocks.map((block, index) => <div className={`script-block ${block.type} ${block.id === activeId ? 'active' : ''} ${block.quiet && !block.text ? 'quiet-empty' : ''} ${block.format?.bold ? 'text-bold' : ''} ${block.format?.italic ? 'text-italic' : ''} ${block.format?.underline ? 'text-underline' : ''} ${block.format?.strike ? 'text-strike' : ''} ${block.format?.highlight ? 'text-highlight' : ''}`} key={block.id}><textarea ref={(node) => { if (node) fields.current.set(block.id, node); else fields.current.delete(block.id) }} rows={1} value={block.text} aria-label={`${typeLabels[block.type]} ${index + 1}`} placeholder={block.quiet ? '' : typeLabels[block.type]} onFocus={() => setActiveId(block.id)} onChange={(event) => updateBlock(block.id, event.target.value)} onKeyDown={(event) => handleKey(event, block, index)} />{block.id === activeId && currentText && filteredSuggestions.length > 0 && <div className="autocomplete">{filteredSuggestions.map((value) => <button key={value} onMouseDown={(event) => { event.preventDefault(); updateBlock(block.id, value) }}>{value}</button>)}</div>}</div>)}<button className="page-add" onClick={() => insertAt(blocks.length, 'action')}>＋</button></article></div>
    </section>
    <aside className="utility-panel"><section><div className="aside-title"><span>DOCUMENT</span><button className="panel-close" onClick={() => setUtilityOpen(false)} aria-label="Close right panel">×</button></div><label className="import-button">Import screenplay<small>PDF · Fountain · TXT</small><input type="file" accept=".pdf,.fountain,.txt,application/pdf,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) openFile(file); event.currentTarget.value = '' }} /></label><button className="snapshot-toggle" onClick={() => setSnapshotsOpen(!snapshotsOpen)}>Version snapshots <b>{snapshots.length}</b></button>{snapshotsOpen && <div className="snapshots">{snapshots.length ? snapshots.map((snapshot) => <button key={snapshot.id} onClick={() => replaceDocument(snapshot.script)}><b>{snapshot.name}</b><span>{snapshot.createdAt}</span></button>) : <p>No snapshots yet.</p>}</div>}</section><section className="keyboard-help"><div className="aside-title"><span>WRITING FLOW</span></div><p><kbd>Click space</kbd> insert text</p><p><kbd>Return</kbd> finish editing</p><p><kbd>↑ ↓</kbd> move between lines</p><p><kbd>Shift Return</kbd> line break</p><p><kbd>Tab</kbd> change element</p><p><kbd>⌘ 1–6</kbd> format line</p><p><kbd>⌘ K</kbd> commands</p></section></aside>
    {draggingFile && <div className="file-drop-overlay"><b>Drop screenplay to convert</b><span>PDF, Fountain, or plain text</span></div>}
    {pdfFile && <PdfImportDialog file={pdfFile} onCancel={() => setPdfFile(null)} onImport={(elements) => { replaceWithElements(elements); setPdfFile(null) }} />}
    {paletteOpen && <div className="palette-backdrop" onMouseDown={() => setPaletteOpen(false)}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}><label>QUICK COMMANDS <kbd>ESC</kbd></label><button onClick={() => runCommand('scene')}>＋ New scene <span>Scene heading at end</span></button><button onClick={() => runCommand('find')}>⌕ Find and replace <span>⌘ F</span></button><button onClick={() => runCommand('snapshot')}>◇ Save snapshot <span>Version history</span></button><button onClick={() => runCommand('export')}>↓ Export Fountain <span>Plain-text screenplay</span></button><button onClick={() => runCommand('print')}>▤ Print / save PDF <span>Production pages</span></button></div></div>}
  </div>
}
