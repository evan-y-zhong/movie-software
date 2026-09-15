import { useEffect, useMemo, useRef, useState } from 'react'
import './BeatMap.css'

type Scene = { id: string; number: number; title: string; description: string; characters: string[] }
type BeatColor = 'paper' | 'rust' | 'blue' | 'olive'
type Beat = { id: string; title: string; description: string; sceneIds: string[]; x: number; y: number; color: BeatColor }
type StoredBlock = { id: string; type: string; text: string }
type Viewport = { x: number; y: number; scale: number }

const BOARD_WIDTH = 2200
const BOARD_HEIGHT = 1300
const CARD_WIDTH = 220
const CARD_HEIGHT = 142
const colors: { value: BeatColor; label: string }[] = [
  { value: 'paper', label: 'Paper' },
  { value: 'rust', label: 'Rust' },
  { value: 'blue', label: 'Blue' },
  { value: 'olive', label: 'Olive' },
]

const projectStorage = (storageKey: string, name: string) => `${storageKey}:${name}`
const readStorage = (storageKey: string, name: string, migrateLegacy: boolean) => localStorage.getItem(projectStorage(storageKey, name)) ?? localStorage.getItem(projectStorage(storageKey.replace(/^logfood:/, 'mise:'), name)) ?? (migrateLegacy ? localStorage.getItem(`mise:${name}`) : null)
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

const characterName = (text: string) => text.replace(/\s*\((?:V\.O\.|O\.S\.|CONT'D|OFF)\)\s*$/i, '').trim()
const isCharacterCue = (text: string) => /^[A-Z][A-Z0-9 ._'()\-]{1,35}$/.test(text)

function scriptScenes(initialScript: string): Scene[] {
  const scenes: Scene[] = []
  initialScript.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean).forEach((paragraph) => {
    const first = paragraph.split('\n')[0].trim()
    if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+/i.test(first)) {
      scenes.push({ id: `initial-scene-${scenes.length + 1}`, number: scenes.length + 1, title: first, description: '', characters: [] })
      return
    }
    const scene = scenes.at(-1)
    if (!scene) return
    if (isCharacterCue(first)) {
      const name = characterName(first)
      if (name && !scene.characters.includes(name)) scene.characters.push(name)
    } else if (!scene.description) scene.description = paragraph
  })
  return scenes
}

function loadScenes(storageKey: string, migrateLegacy: boolean, initialScript: string) {
  try {
    const blocks = JSON.parse(readStorage(storageKey, 'document', migrateLegacy) || 'null') as StoredBlock[] | null
    if (Array.isArray(blocks)) {
      const scenes = blocks.flatMap((block, blockIndex) => {
        if (block.type !== 'scene') return []
        const nextSceneIndex = blocks.findIndex((candidate, index) => index > blockIndex && candidate.type === 'scene')
        const sceneEnd = nextSceneIndex === -1 ? blocks.length : nextSceneIndex
        const sceneBlocks = blocks.slice(blockIndex + 1, sceneEnd)
        const description = sceneBlocks.find((candidate) => candidate.type === 'action' && candidate.text.trim())?.text || ''
        const characters = [...new Set(sceneBlocks.filter((candidate) => candidate.type === 'character').map((candidate) => characterName(candidate.text)).filter(Boolean))]
        return [{ id: block.id, number: 0, title: block.text || 'Untitled scene', description, characters }]
      })
      return scenes.map((scene, index) => ({ ...scene, number: index + 1 }))
    }
  } catch { /* Fall back to the initial script. */ }
  return scriptScenes(initialScript)
}

function boardPosition(index: number) {
  return { x: 110 + (index % 7) * 285, y: 100 + Math.floor(index / 7) * 195 + (index % 2) * 34 }
}

function normalizedBeat(value: unknown, index: number, scenes: Scene[]): Beat | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as Partial<Beat> & { kind?: string; act?: number }
  if (typeof saved.id !== 'string') return null
  const position = boardPosition(index)
  const legacyColor: BeatColor = saved.kind === 'structure' ? 'rust' : saved.act === 2 ? 'blue' : saved.act === 3 ? 'olive' : 'paper'
  const savedSceneIds = Array.isArray(saved.sceneIds) ? saved.sceneIds.filter((id): id is string => typeof id === 'string') : []
  const sceneIds = savedSceneIds.map((id) => {
    if (scenes.some((scene) => scene.id === id)) return id
    const initialSceneNumber = id.match(/^initial-scene-(\d+)$/)?.[1]
    return initialSceneNumber ? scenes[Number(initialSceneNumber) - 1]?.id || id : id
  })
  return {
    id: saved.id,
    title: typeof saved.title === 'string' ? saved.title : 'Untitled event',
    description: typeof saved.description === 'string' ? saved.description : '',
    sceneIds,
    x: typeof saved.x === 'number' ? saved.x : position.x,
    y: typeof saved.y === 'number' ? saved.y : position.y,
    color: colors.some((color) => color.value === saved.color) ? saved.color as BeatColor : legacyColor,
  }
}

function loadBeats(storageKey: string, migrateLegacy: boolean, scenes: Scene[]) {
  try {
    const saved = JSON.parse(readStorage(storageKey, 'beats', migrateLegacy) || 'null')
    if (Array.isArray(saved)) return saved.map((beat, index) => normalizedBeat(beat, index, scenes)).filter((beat): beat is Beat => Boolean(beat))
  } catch { /* Generate the first beat map from screenplay scenes. */ }
  return scenes.map((scene, index): Beat => ({
    id: crypto.randomUUID(),
    title: scene.title,
    description: scene.description,
    sceneIds: [scene.id],
    ...boardPosition(index),
    color: index % 4 === 1 ? 'rust' : index % 4 === 2 ? 'blue' : index % 4 === 3 ? 'olive' : 'paper',
  }))
}

export default function BeatMap({ title, initialScript, storageKey, migrateLegacy = false, onOpenScreenplay }: { title: string; initialScript: string; storageKey: string; migrateLegacy?: boolean; onOpenScreenplay: (sceneId?: string) => void }) {
  const scenes = useMemo(() => loadScenes(storageKey, migrateLegacy, initialScript), [initialScript, migrateLegacy, storageKey])
  const characters = useMemo(() => [...new Set(scenes.flatMap((scene) => scene.characters))], [scenes])
  const [beats, setBeats] = useState<Beat[]>(() => loadBeats(storageKey, migrateLegacy, scenes))
  const [view, setView] = useState<'freeform' | 'characters'>(() => readStorage(storageKey, 'beat-map-view', migrateLegacy) === 'characters' ? 'characters' : 'freeform')
  const [selectedId, setSelectedId] = useState('')
  const [saveState, setSaveState] = useState('Saved')
  const [showActGuides, setShowActGuides] = useState(true)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSceneId, setNewSceneId] = useState('')
  const [newColor, setNewColor] = useState<BeatColor>('paper')
  const [newPosition, setNewPosition] = useState({ x: 110, y: 100 })
  const stageRef = useRef<HTMLElement>(null)
  const viewportRef = useRef(viewport)
  const dragRef = useRef<{ id: string; pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const panRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const selectedBeat = beats.find((beat) => beat.id === selectedId)

  useEffect(() => { viewportRef.current = viewport }, [viewport])
  useEffect(() => { localStorage.setItem(projectStorage(storageKey, 'beat-map-view'), view) }, [storageKey, view])

  useEffect(() => {
    setSaveState('Saving…')
    const timer = window.setTimeout(() => {
      localStorage.setItem(projectStorage(storageKey, 'beats'), JSON.stringify(beats))
      setSaveState('Saved')
    }, 250)
    return () => window.clearTimeout(timer)
  }, [beats, storageKey])

  const updateBeat = (change: Partial<Beat>) => {
    if (!selectedId) return
    setBeats((current) => current.map((beat) => beat.id === selectedId ? { ...beat, ...change } : beat))
  }

  const removeSelectedBeat = () => {
    if (!selectedId) return
    setBeats((current) => current.filter((beat) => beat.id !== selectedId))
    setSelectedId('')
  }

  const viewportCenter = () => {
    const bounds = stageRef.current?.getBoundingClientRect()
    const current = viewportRef.current
    if (!bounds) return { x: 110, y: 100 }
    return {
      x: clamp((bounds.width / 2 - current.x) / current.scale - CARD_WIDTH / 2, 20, BOARD_WIDTH - CARD_WIDTH - 20),
      y: clamp((bounds.height / 2 - current.y) / current.scale - CARD_HEIGHT / 2, 54, BOARD_HEIGHT - CARD_HEIGHT - 20),
    }
  }

  const openCreator = (position = viewportCenter()) => {
    setNewPosition(position)
    setNewTitle('')
    setNewDescription('')
    setNewSceneId('')
    setNewColor('paper')
    setCreating(true)
  }

  const createBeat = (event: React.FormEvent) => {
    event.preventDefault()
    const beat: Beat = {
      id: crypto.randomUUID(),
      title: newTitle.trim() || 'Untitled event',
      description: newDescription.trim(),
      sceneIds: newSceneId ? [newSceneId] : [],
      x: newPosition.x,
      y: newPosition.y,
      color: newColor,
    }
    setBeats((current) => [...current, beat])
    setSelectedId(beat.id)
    setCreating(false)
  }

  const setScaleAroundPoint = (nextScale: number, clientX?: number, clientY?: number) => {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const current = viewportRef.current
    const localX = clientX === undefined ? bounds.width / 2 : clientX - bounds.left
    const localY = clientY === undefined ? bounds.height / 2 : clientY - bounds.top
    const scale = clamp(nextScale, .45, 1.5)
    const worldX = (localX - current.x) / current.scale
    const worldY = (localY - current.y) / current.scale
    setViewport({ x: localX - worldX * scale, y: localY - worldY * scale, scale })
  }

  const fitBoard = () => {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    if (!beats.length) {
      setViewport({ x: 30, y: 30, scale: 1 })
      return
    }
    const left = Math.min(...beats.map((beat) => beat.x))
    const top = Math.min(...beats.map((beat) => beat.y))
    const right = Math.max(...beats.map((beat) => beat.x + CARD_WIDTH))
    const bottom = Math.max(...beats.map((beat) => beat.y + CARD_HEIGHT))
    const padding = 90
    const scale = clamp(Math.min((bounds.width - padding * 2) / (right - left), (bounds.height - padding * 2) / (bottom - top)), .45, 1.15)
    setViewport({ x: (bounds.width - (right - left) * scale) / 2 - left * scale, y: (bounds.height - (bottom - top) * scale) / 2 - top * scale, scale })
  }

  const beginCardDrag = (event: React.PointerEvent<HTMLElement>, beat: Beat) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(beat.id)
    dragRef.current = { id: beat.id, pointerX: event.clientX, pointerY: event.clientY, startX: beat.x, startY: beat.y }
  }

  const moveCard = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const scale = viewportRef.current.scale
    const x = clamp(drag.startX + (event.clientX - drag.pointerX) / scale, 0, BOARD_WIDTH - CARD_WIDTH)
    const y = clamp(drag.startY + (event.clientY - drag.pointerY) / scale, 42, BOARD_HEIGHT - CARD_HEIGHT)
    setBeats((current) => current.map((beat) => beat.id === drag.id ? { ...beat, x, y } : beat))
  }

  const endCardDrag = (event: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const beginPan = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.event-card')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = viewportRef.current
    panRef.current = { pointerX: event.clientX, pointerY: event.clientY, startX: current.x, startY: current.y }
    setSelectedId('')
  }

  const movePan = (event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current
    if (!pan) return
    setViewport((current) => ({ ...current, x: pan.startX + event.clientX - pan.pointerX, y: pan.startY + event.clientY - pan.pointerY }))
  }

  const endPan = (event: React.PointerEvent<HTMLElement>) => {
    panRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const addAtDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.event-card')) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const current = viewportRef.current
    openCreator({
      x: clamp((event.clientX - bounds.left - current.x) / current.scale - CARD_WIDTH / 2, 0, BOARD_WIDTH - CARD_WIDTH),
      y: clamp((event.clientY - bounds.top - current.y) / current.scale - CARD_HEIGHT / 2, 42, BOARD_HEIGHT - CARD_HEIGHT),
    })
  }

  return <div className="beat-map-shell">
    <header className="beat-board-toolbar">
      <div className="beat-board-title"><h1>Beat Map</h1><span>{view === 'freeform' ? `${beats.length} ${beats.length === 1 ? 'event' : 'events'} · ${saveState}` : `${characters.length} ${characters.length === 1 ? 'character' : 'characters'} · ${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'}`}</span></div>
      <nav className="beat-workspace-switch" aria-label="Project workspaces">
        <button onClick={() => onOpenScreenplay()}>▤ Screenplay</button>
        <button className="active" aria-current="page">⌁ Beat Map</button>
      </nav>
      <div className="beat-board-actions">
        <div className="beat-layout-switch" aria-label="Beat Map view"><button className={view === 'freeform' ? 'active' : ''} aria-pressed={view === 'freeform'} onClick={() => setView('freeform')}>Freeform</button><button className={view === 'characters' ? 'active' : ''} aria-pressed={view === 'characters'} onClick={() => setView('characters')}>Characters</button></div>
        {view === 'freeform' && <><button className={showActGuides ? 'active' : ''} aria-pressed={showActGuides} onClick={() => setShowActGuides((current) => !current)}>Act guides</button>
          <button onClick={fitBoard}>Fit board</button>
          <div className="beat-zoom-control"><button aria-label="Zoom out" onClick={() => setScaleAroundPoint(viewport.scale - .1)}>−</button><span>{Math.round(viewport.scale * 100)}%</span><button aria-label="Zoom in" onClick={() => setScaleAroundPoint(viewport.scale + .1)}>＋</button></div>
          <button className="add-event-button" onClick={() => openCreator()}>＋ Event</button></>}
      </div>
    </header>

    {view === 'freeform' ? <section ref={stageRef} className={`beat-board-stage ${panRef.current ? 'panning' : ''}`} aria-label="Beat Map whiteboard" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onDoubleClick={addAtDoubleClick} onWheel={(event) => { event.preventDefault(); setScaleAroundPoint(viewportRef.current.scale + (event.deltaY < 0 ? .08 : -.08), event.clientX, event.clientY) }}>
      <div className="beat-board-canvas" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        {showActGuides && <div className="beat-act-guides" aria-hidden="true"><div><span>ACT I</span></div><div><span>ACT II</span></div><div><span>ACT III</span></div></div>}
        {beats.map((beat, index) => {
          const linkedScene = scenes.find((scene) => scene.id === beat.sceneIds[0])
          return <article key={beat.id} className={`event-card color-${beat.color} ${beat.id === selectedId ? 'selected' : ''}`} style={{ left: beat.x, top: beat.y }} tabIndex={0} aria-label={`${beat.title}. ${beat.description}`} onFocus={() => setSelectedId(beat.id)} onPointerDown={(event) => beginCardDrag(event, beat)} onPointerMove={moveCard} onPointerUp={endCardDrag} onPointerCancel={endCardDrag}>
            <span className="event-card-number">EVENT {String(index + 1).padStart(2, '0')}</span>
            <h2>{beat.title}</h2>
            <p>{beat.description || 'Add a quick description of what happens.'}</p>
            <span className="event-card-scene">{linkedScene ? `Scene ${linkedScene.number} · linked` : 'Unlinked idea'}</span>
          </article>
        })}
        {!beats.length && <button className="empty-beat-board" onClick={() => openCreator()}><span>＋</span><b>Add the first event</b><small>Place one clear story moment on the board.</small></button>}
      </div>
      <div className="beat-board-hint">Double-click to add · Drag the board to move around</div>
    </section> : <section className="character-map" aria-label="Character scene map">
      {characters.length && scenes.length ? <div className="character-map-scroll">
        <div className="character-map-header" style={{ gridTemplateColumns: `170px repeat(${scenes.length}, 220px)` }}>
          <div className="character-corner">CHARACTER</div>
          {scenes.map((scene) => <button key={scene.id} onClick={() => onOpenScreenplay(scene.id)}><span>SCENE {String(scene.number).padStart(2, '0')}</span><b>{scene.title}</b></button>)}
        </div>
        {characters.map((character) => {
          const appearanceCount = scenes.filter((scene) => scene.characters.includes(character)).length
          return <div className="character-row" key={character} style={{ gridTemplateColumns: `170px repeat(${scenes.length}, 220px)` }}>
            <div className="character-label"><h2>{character}</h2><span>{appearanceCount} {appearanceCount === 1 ? 'scene' : 'scenes'}</span></div>
            {scenes.map((scene) => <div className="character-scene-cell" key={scene.id}>{scene.characters.includes(character) && <button onClick={() => onOpenScreenplay(scene.id)} aria-label={`Open scene ${scene.number}, ${scene.title}, featuring ${character}`}><span>{scene.title}</span><p>{scene.description || `${character} appears in this scene.`}</p><small>Open scene →</small></button>}</div>)}
          </div>
        })}
      </div> : <div className="empty-character-map"><h2>No character appearances yet</h2><p>Character rows are created automatically from dialogue cues in the screenplay.</p><button onClick={() => onOpenScreenplay()}>Open screenplay</button></div>}
      <div className="character-map-note">Generated from screenplay character cues</div>
    </section>}

    {view === 'freeform' && selectedBeat && <aside className="event-inspector" aria-label="Selected event">
      <div className="event-inspector-heading"><div><span>SELECTED EVENT</span><h2>Edit event</h2></div><button onClick={() => setSelectedId('')} aria-label="Close event editor">×</button></div>
      <div className="event-inspector-form">
        <label>Title<input value={selectedBeat.title} onChange={(event) => updateBeat({ title: event.target.value })} /></label>
        <label>Quick description<textarea rows={5} value={selectedBeat.description} onChange={(event) => updateBeat({ description: event.target.value })} placeholder="What happens in this moment?" /></label>
        <label>Card color<select value={selectedBeat.color} onChange={(event) => updateBeat({ color: event.target.value as BeatColor })}>{colors.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select></label>
        <label>Linked scene<select value={selectedBeat.sceneIds[0] || ''} onChange={(event) => updateBeat({ sceneIds: event.target.value ? [event.target.value] : [] })}><option value="">No linked scene</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.number}. {scene.title}</option>)}</select></label>
        {selectedBeat.sceneIds[0] && <button className="open-linked-scene" onClick={() => onOpenScreenplay(selectedBeat.sceneIds[0])}>Open linked scene →</button>}
        <button className="delete-event" onClick={removeSelectedBeat}>Delete event</button>
      </div>
    </aside>}

    {creating && <div className="beat-dialog-backdrop" onMouseDown={() => setCreating(false)}><form className="beat-dialog" onSubmit={createBeat} onMouseDown={(event) => event.stopPropagation()}>
      <div className="beat-dialog-heading"><div><span>NEW EVENT</span><h2>Add to the board</h2></div><button type="button" onClick={() => setCreating(false)} aria-label="Close">×</button></div>
      <label>Title<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="What happens?" /></label>
      <label>Quick description<textarea rows={4} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Describe the event in one or two sentences" /></label>
      <div className="beat-dialog-row"><label>Card color<select value={newColor} onChange={(event) => setNewColor(event.target.value as BeatColor)}>{colors.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select></label><label>Linked scene<select value={newSceneId} onChange={(event) => setNewSceneId(event.target.value)}><option value="">No linked scene</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.number}. {scene.title}</option>)}</select></label></div>
      <div className="beat-dialog-actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button><button type="submit">Add event</button></div>
    </form></div>}
  </div>
}
