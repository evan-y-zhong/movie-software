import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type ViewMode = 'composite' | 'mask' | 'diagnostic'
type Region = { x: number; y: number; width: number; height: number }

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const referenceRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const [view, setView] = useState<ViewMode>('composite')
  const [keyColor, setKeyColor] = useState({ r: 54, g: 163, b: 77 })
  const [tolerance, setTolerance] = useState(82)
  const [feather, setFeather] = useState(28)
  const [reference, setReference] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState('No source selected')
  const [cameraActive, setCameraActive] = useState(false)
  const [status, setStatus] = useState('Ready for input')
  const [sampled, setSampled] = useState(false)
  const [screenRegion, setScreenRegion] = useState<Region>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 })
  const [clipLoaded, setClipLoaded] = useState(false)
  const [clipPaused, setClipPaused] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const drawFrame = useCallback(() => {
    const video = videoRef.current
    const output = canvasRef.current
    const ref = referenceRef.current
    if (!video || !output || video.readyState < 2) return

    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    if (output.width !== width || output.height !== height) {
      output.width = width
      output.height = height
      frameRef.current.width = width
      frameRef.current.height = height
    }

    const frame = frameRef.current
    const frameCtx = frame.getContext('2d', { willReadFrequently: true })!
    const outCtx = output.getContext('2d')!
    frameCtx.drawImage(video, 0, 0, width, height)
    const image = frameCtx.getImageData(0, 0, width, height)
    const pixels = image.data
    const { r: kr, g: kg, b: kb } = keyColor
    const min = tolerance * 0.65
    const span = Math.max(1, tolerance - min + feather)
    const regionLeft = Math.round(screenRegion.x * width)
    const regionTop = Math.round(screenRegion.y * height)
    const regionRight = Math.round((screenRegion.x + screenRegion.width) * width)
    const regionBottom = Math.round((screenRegion.y + screenRegion.height) * height)
    let luminanceTotal = 0, redTotal = 0, greenTotal = 0, blueTotal = 0, regionSamples = 0
    if (view === 'diagnostic') {
      for (let y = regionTop; y < regionBottom; y += 4) for (let x = regionLeft; x < regionRight; x += 4) {
        const i = (y * width + x) * 4
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
        luminanceTotal += r * 0.2126 + g * 0.7152 + b * 0.0722
        redTotal += r; greenTotal += g; blueTotal += b; regionSamples += 1
      }
    }
    const averageLuminance = luminanceTotal / Math.max(1, regionSamples)
    const averageRed = redTotal / Math.max(1, regionSamples)
    const averageGreen = greenTotal / Math.max(1, regionSamples)
    const averageBlue = blueTotal / Math.max(1, regionSamples)

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const distance = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2)
      const keyAmount = Math.max(0, Math.min(1, (distance - min) / span))
      const alpha = Math.round(keyAmount * 255)

      if (view === 'mask') {
        pixels[i] = alpha
        pixels[i + 1] = alpha
        pixels[i + 2] = alpha
        pixels[i + 3] = 255
      } else if (view === 'diagnostic') {
        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722
        const x = (i / 4) % width
        const y = Math.floor(i / 4 / width)
        const inScreenRegion = x >= regionLeft && x < regionRight && y >= regionTop && y < regionBottom
        if (!inScreenRegion) {
          const dim = luminance * 0.34
          pixels[i] = dim; pixels[i + 1] = dim; pixels[i + 2] = dim
        } else {
          const lightDeviation = Math.abs(luminance - averageLuminance) / 30
          const colorDeviation = Math.sqrt((r - averageRed) ** 2 + (g - averageGreen) ** 2 + (b - averageBlue) ** 2) / 58
          const deviation = Math.min(1, (lightDeviation + colorDeviation) / 2)
          pixels[i] = Math.round(35 + deviation * 220)
          pixels[i + 1] = Math.round(185 - deviation * 125)
          pixels[i + 2] = Math.round(255 - deviation * 220)
        }
        pixels[i + 3] = 255
      } else {
        pixels[i + 3] = alpha
      }
    }

    // Write the processed matte to an off-screen frame first. `putImageData`
    // ignores compositing rules, so putting it directly on the output would
    // erase the reference plate wherever alpha is zero.
    frameCtx.putImageData(image, 0, 0)
    if (view === 'composite' && ref && ref.complete) outCtx.drawImage(ref, 0, 0, width, height)
    else {
      outCtx.fillStyle = view === 'mask' ? '#090b0d' : '#151919'
      outCtx.fillRect(0, 0, width, height)
    }
    outCtx.drawImage(frame, 0, 0)
  }, [feather, keyColor, reference, screenRegion, tolerance, view])

  useEffect(() => {
    let animation = 0
    const render = () => {
      drawFrame()
      animation = requestAnimationFrame(render)
    }
    animation = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animation)
  }, [drawFrame])

  useEffect(() => () => {
    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const loadVideo = (file: File) => {
    const video = videoRef.current!
    if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src)
    video.srcObject = null
    video.src = URL.createObjectURL(file)
    video.play().catch(() => undefined)
    setCameraActive(false)
    setClipLoaded(true)
    setClipPaused(false)
    setSourceLabel(file.name)
    setStatus('Video feed live')
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
      const video = videoRef.current!
      video.src = ''
      video.srcObject = stream
      await video.play()
      setCameraActive(true)
      setClipLoaded(false)
      setSourceLabel('Camera input')
      setStatus('Camera live · auto controls may be active')
    } catch {
      setStatus('Camera permission unavailable — load a clip instead')
    }
  }

  const toggleClipPlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().then(() => {
        setClipPaused(false)
        setStatus('Video playback resumed')
      }).catch(() => setStatus('Unable to resume this clip'))
    } else {
      video.pause()
      setClipPaused(true)
      setStatus('Video playback paused')
    }
  }

  const restartClip = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    video.play().then(() => {
      setClipPaused(false)
      setStatus('Video restarted')
    }).catch(() => setStatus('Video reset to beginning'))
  }

  const normalizedPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }

  const sampleKey = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const source = frameRef.current
    const point = normalizedPointer(event)
    if (!point || source.width === 0) return
    const x = Math.round(point.x * source.width)
    const y = Math.round(point.y * source.height)
    const context = source.getContext('2d', { willReadFrequently: true })!
    const data = context.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
    const count = data.length / 4
    setKeyColor({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) })
    setSampled(true)
    setStatus('Key sample updated from 9 × 9 patch')
  }

  const startRegion = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (view !== 'diagnostic') { sampleKey(event); return }
    dragStart.current = normalizedPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateRegion = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStart.current
    const point = normalizedPointer(event)
    if (!start || !point) return
    setScreenRegion({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) })
  }

  const finishRegion = () => {
    if (!dragStart.current) return
    dragStart.current = null
    setStatus('Lighting check region updated · blue is even, red needs attention')
  }

  const exportStill = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `chromaclick-${view}-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    setStatus('Still exported with current view')
  }

  const keyHex = `#${[keyColor.r, keyColor.g, keyColor.b].map((part) => part.toString(16).padStart(2, '0')).join('')}`

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>ChromaClick</span><small>ON-SET MONITOR</small></div>
        <div className="shoot-status"><span className="status-dot" /> {status}</div>
        <button className="export-button" onClick={exportStill}>Export still</button>
      </header>

      <section className="workspace">
        <div className="monitor-panel">
          <div className="monitor-toolbar">
            <div className="mode-tabs">
              {(['composite', 'mask', 'diagnostic'] as ViewMode[]).map((mode) => <button key={mode} className={view === mode ? 'active' : ''} onClick={() => setView(mode)}>{mode}</button>)}
            </div>
            <span className="source-label">{sourceLabel}</span>
          </div>
          <div className="monitor-stage">
            <canvas ref={canvasRef} onPointerDown={startRegion} onPointerMove={updateRegion} onPointerUp={finishRegion} aria-label="Live keyed video preview. Click a key-screen color to sample it, or drag a screen area in diagnostic mode." />
            {!cameraActive && sourceLabel === 'No source selected' && <div className="empty-state"><span>01</span><h1>Bring in a live feed</h1><p>Connect a camera or load a test clip, then click the screen color to key it.</p></div>}
            <div className="safe-frame" />
            {view === 'diagnostic' && <div className="screen-region" style={{ left: `${screenRegion.x * 100}%`, top: `${screenRegion.y * 100}%`, width: `${screenRegion.width * 100}%`, height: `${screenRegion.height * 100}%` }}><span>SCREEN REGION</span></div>}
            {sampled && <div className="sample-notice">PATCH SAMPLE · {keyHex.toUpperCase()}</div>}
          </div>
          <div className="monitor-foot"><span>{view === 'diagnostic' ? 'DRAG OVER THE GREENSCREEN TO ANALYZE IT' : 'CLICK FRAME TO SAMPLE KEY COLOR'}</span><span>{view === 'diagnostic' ? 'UNIFORMITY HEATMAP' : view === 'mask' ? 'ALPHA CHANNEL' : 'REFERENCE COMPOSITE'}</span></div>
        </div>

        <aside className="control-panel">
          <section className="control-section source-section"><div className="section-title"><span>01</span> INPUT</div><button className="camera-button" onClick={startCamera}>◉ Enable camera</button><label className="file-button">Load video clip<input type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && loadVideo(e.target.files[0])} /></label>{clipLoaded && <div className="clip-controls"><button onClick={toggleClipPlayback}>{clipPaused ? '▶ Resume clip' : 'Ⅱ Pause clip'}</button><button onClick={restartClip}>↺ Restart</button></div>}</section>
          <section className="control-section"><div className="section-title"><span>02</span> KEY COLOR</div><div className="color-readout"><span className="color-chip" style={{ background: keyHex }} /><code>{keyHex.toUpperCase()}</code><button onClick={() => setSampled(false)}>Reset</button></div><p className="hint">Click a clean, evenly lit patch of your key surface.</p></section>
          <section className="control-section"><div className="section-title"><span>03</span> MATTE</div><label className="slider-row">Tolerance <output>{tolerance}</output><input type="range" min="20" max="180" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /></label><label className="slider-row">Edge feather <output>{feather}</output><input type="range" min="0" max="80" value={feather} onChange={(e) => setFeather(Number(e.target.value))} /></label></section>
          <section className="control-section"><div className="section-title"><span>04</span> REFERENCE PLATE</div><label className="file-button">{reference ? 'Replace reference image' : 'Load reference image'}<input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) setReference(URL.createObjectURL(file)) }} /></label>{reference && <button className="clear-link" onClick={() => setReference(null)}>Remove plate</button>}</section>
          <section className="control-section diagnostic-card"><div className="section-title"><span>05</span> LIGHTING CHECK</div><p>In Diagnostic, drag a box over the green screen. Blue matches that region's average; red marks lighting or color variation.</p><button onClick={() => setView('diagnostic')}>Open diagnostic</button></section>
        </aside>
      </section>
      <video ref={videoRef} muted playsInline className="hidden-video" />
      {reference && <img ref={referenceRef} src={reference} className="hidden-video" alt="" />}
    </main>
  )
}

export default App
