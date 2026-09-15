import { useEffect, useState } from 'react'
import ScreenplayEditor from './ScreenplayEditor'

const sampleScript = `INT. ALL-NIGHT LAUNDROMAT - NIGHT

Rain scribbles against the glass. MAYA, 28, watches a red sock turn everything pink. The bell over the door rings. Her estranged brother NOAH enters, carrying their father's old camera.

MAYA
You kept it.

NOAH
I kept the film, too.

Neither of them reaches for the other. The dryers turn like distant thunder.

EXT. LAUNDROMAT PARKING LOT - DAWN

The rain has stopped. Maya holds the undeveloped film up to the new light. Noah waits by his car, unsure whether he has been forgiven.`

export default function App() {
  const [title, setTitle] = useState(() => localStorage.getItem('mise:title') || 'UNTITLED SCREENPLAY')

  useEffect(() => { localStorage.setItem('mise:title', title) }, [title])

  return <main className="app">
    <header className="topbar">
      <input className="document-title-input" value={title} onChange={(event) => setTitle(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} aria-label="Screenplay title" spellCheck={false} />
    </header>
    <ScreenplayEditor initialScript={sampleScript} title={title} onTitleChange={setTitle} />
  </main>
}
