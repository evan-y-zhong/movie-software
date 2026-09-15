import { useEffect, useMemo, useState } from 'react'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { ElementType } from './ScreenplayEditor'

export type ImportedElement = { type: ElementType; text: string }
type ReviewElement = ImportedElement & { id: string; page: number; confidence: number; reason: string }
type RawLine = { page: number; text: string; x: number; top: number; height: number; pageWidth: number }

const labels: Record<ElementType, string> = { scene: 'Scene heading', action: 'Action', character: 'Character', dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition' }
const elementTypes = Object.keys(labels) as ElementType[]

function joinItems(items: TextItem[]) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4])
  let text = ''
  let right = 0
  sorted.forEach((item, index) => {
    const x = item.transform[4]
    const average = item.str.length ? item.width / item.str.length : 3
    if (index && x - right > Math.max(1.5, average * .45) && !text.endsWith(' ')) text += ' '
    text += item.str
    right = Math.max(right, x + item.width)
  })
  return text.replace(/\s+/g, ' ').trim()
}

async function extractLines(file: File): Promise<RawLine[]> {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = pdfWorker
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
  const lines: RawLine[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = content.items.filter((item): item is TextItem => 'str' in item && Boolean(item.str.trim()))
    const rows: TextItem[][] = []
    items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]).forEach((item) => {
      const row = rows.find((candidate) => Math.abs(candidate[0].transform[5] - item.transform[5]) <= 2.5)
      if (row) row.push(item)
      else rows.push([item])
    })
    rows.sort((a, b) => b[0].transform[5] - a[0].transform[5]).forEach((row) => {
      const text = joinItems(row)
      const x = Math.min(...row.map((item) => item.transform[4]))
      const y = row.reduce((sum, item) => sum + item.transform[5], 0) / row.length
      const height = Math.max(...row.map((item) => Math.abs(item.transform[3]) || item.height || 10))
      const top = viewport.height - y
      const inMargin = top < 34 || top > viewport.height - 30
      if (!text || (inMargin && /^\s*(?:\d+\.?|.+\s+-\s+\d+)\s*$/.test(text))) return
      lines.push({ page: pageNumber, text, x, top, height, pageWidth: viewport.width })
    })
  }
  return lines
}

function classify(lines: RawLine[]): ReviewElement[] {
  const firstScene = lines.findIndex((line) => /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+/i.test(line.text))
  const body = firstScene > 0 ? lines.slice(firstScene) : lines
  const reviewed: ReviewElement[] = []

  body.forEach((line) => {
    const text = line.text.trim()
    const x = line.x / line.pageWidth
    const uppercase = text === text.toUpperCase() && /[A-Z]/.test(text)
    const previous = reviewed.at(-1)
    let type: ElementType = 'action'
    let confidence = .72
    let reason = 'Body text'

    if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+/i.test(text)) { type = 'scene'; confidence = .99; reason = 'Scene-heading prefix' }
    else if (/^(?:FADE (?:IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT TO|MATCH CUT TO).*:?$/i.test(text)) { type = 'transition'; confidence = .98; reason = 'Transition phrase' }
    else if (/^\(.+\)$/.test(text)) { type = 'parenthetical'; confidence = .96; reason = 'Parenthetical punctuation' }
    else if (uppercase && text.length <= 45 && x >= .31 && x < .72) { type = 'character'; confidence = .9; reason = 'Centered uppercase cue' }
    else if (previous?.type === 'character' || previous?.type === 'parenthetical') { type = 'dialogue'; confidence = .94; reason = 'Follows a character cue' }
    else if (previous?.type === 'dialogue' && x >= .24 && x < .62) { type = 'dialogue'; confidence = .82; reason = 'Dialogue indentation' }
    else if (x >= .25 && x < .58) { type = 'dialogue'; confidence = .62; reason = 'Indented text; please verify' }
    else if (uppercase && text.length <= 45) { type = 'character'; confidence = .58; reason = 'Uppercase short line; please verify' }

    const canMerge = previous && previous.page === line.page && previous.type === type && (type === 'action' || type === 'dialogue')
    if (canMerge) {
      previous.text += ` ${text}`
      if (confidence < previous.confidence) previous.reason = reason
      previous.confidence = Math.min(previous.confidence, confidence)
    } else reviewed.push({ id: crypto.randomUUID(), page: line.page, type, text, confidence, reason })
  })
  return reviewed
}

export default function PdfImportDialog({ file, onCancel, onImport }: { file: File; onCancel: () => void; onImport: (elements: ImportedElement[]) => void }) {
  const [elements, setElements] = useState<ReviewElement[]>([])
  const [status, setStatus] = useState('Reading PDF…')
  const [error, setError] = useState('')
  const [uncertainOnly, setUncertainOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    extractLines(file).then((lines) => {
      if (cancelled) return
      const classified = classify(lines)
      if (!classified.length) throw new Error('No screenplay text could be detected in this PDF.')
      setElements(classified)
      setStatus('')
    }).catch((reason: unknown) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'This PDF could not be read.'); setStatus('') } })
    return () => { cancelled = true }
  }, [file])

  const uncertain = useMemo(() => elements.filter((element) => element.confidence < .75).length, [elements])
  const shown = uncertainOnly ? elements.filter((element) => element.confidence < .75) : elements
  const update = (id: string, change: Partial<ReviewElement>) => setElements((current) => current.map((element) => element.id === id ? { ...element, ...change, confidence: change.type ? 1 : element.confidence, reason: change.type ? 'Confirmed by you' : element.reason } : element))

  return <div className="pdf-review-backdrop" onMouseDown={onCancel}>
    <section className="pdf-review" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="pdf-review-title">
      <header><div><span>PDF CONVERTER</span><h2 id="pdf-review-title">Review detected screenplay</h2><p>{file.name}</p></div><button onClick={onCancel} aria-label="Close PDF review">×</button></header>
      {status && <div className="pdf-status"><i /><b>{status}</b><span>Everything stays in this browser.</span></div>}
      {error && <div className="pdf-error"><b>We couldn’t convert this file.</b><span>{error}</span></div>}
      {!status && !error && <><div className="pdf-summary"><span><b>{elements.length}</b> elements detected</span><span className={uncertain ? 'needs-review' : ''}><b>{uncertain}</b> need review</span><label><input type="checkbox" checked={uncertainOnly} onChange={(event) => setUncertainOnly(event.target.checked)} /> Show uncertain only</label></div>
      <div className="pdf-elements">{shown.map((element) => <article className={element.confidence < .75 ? 'uncertain' : ''} key={element.id}><div className="pdf-element-meta"><span>PAGE {element.page}</span><select value={element.type} onChange={(event) => update(element.id, { type: event.target.value as ElementType })}>{elementTypes.map((type) => <option value={type} key={type}>{labels[type]}</option>)}</select><small>{Math.round(element.confidence * 100)}% · {element.reason}</small><button onClick={() => setElements((current) => current.filter((item) => item.id !== element.id))}>Remove</button></div><textarea value={element.text} onChange={(event) => update(element.id, { text: event.target.value })} rows={element.text.length > 90 ? 3 : 2} /></article>)}</div>
      <footer><button onClick={onCancel}>Cancel</button><button className="import-confirm" disabled={!elements.length} onClick={() => onImport(elements.map(({ type, text }) => ({ type, text })))}>Import {elements.length} elements</button></footer></>}
    </section>
  </div>
}
