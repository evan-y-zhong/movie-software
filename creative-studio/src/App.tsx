import { useEffect, useState } from 'react'
import BeatMap from './BeatMap'
import Dashboard, { slugify, type CreativeProject } from './Dashboard'
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

const defaultProjects = (title: string): CreativeProject[] => [
  {
    id: 'all-night-laundromat',
    slug: slugify(title) || 'untitled-screenplay',
    title,
    format: 'Feature film',
    updatedAt: new Date().toISOString(),
    workspaces: ['Screenplay', 'Beat map'],
    accent: 'rust',
  },
]

function loadProjects() {
  const legacyTitle = localStorage.getItem('logfood:title') || localStorage.getItem('mise:title') || 'Untitled Screenplay'
  try {
    const saved = JSON.parse(localStorage.getItem('logfood:projects') || localStorage.getItem('mise:projects') || 'null')
    if (Array.isArray(saved) && saved.length) {
      const realProjects = saved.filter((project: CreativeProject) => !['the-quiet-mile', 'field-notes'].includes(project.id))
      if (realProjects.length) return realProjects.map((project: CreativeProject) => ({ ...project, slug: project.slug || slugify(project.title) || project.id, workspaces: ['Screenplay', 'Beat map'] }))
    }
  } catch { /* Start with the sample project set. */ }
  return defaultProjects(legacyTitle)
}

export default function App() {
  const [route, setRoute] = useState(window.location.pathname)
  const [projects, setProjects] = useState<CreativeProject[]>(loadProjects)
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem('logfood:active-project') || localStorage.getItem('mise:active-project') || 'all-night-laundromat')
  const routeMatch = route.match(/^\/movie\/([^/]+)(?:\/(beat-map))?\/?$/)
  const routeSlug = routeMatch?.[1]
  const workspace = routeMatch?.[2] === 'beat-map' ? 'beat-map' : 'screenplay'
  const routeProject = routeSlug ? projects.find((project) => project.slug === decodeURIComponent(routeSlug)) : undefined
  const activeProject = routeProject || projects.find((project) => project.id === activeProjectId) || projects[0]

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => { localStorage.setItem('logfood:projects', JSON.stringify(projects)) }, [projects])
  useEffect(() => { localStorage.setItem('logfood:active-project', activeProjectId) }, [activeProjectId])
  useEffect(() => {
    if (route.startsWith('/movie') && activeProject) {
      if (routeProject && routeProject.id !== activeProjectId) setActiveProjectId(routeProject.id)
      const canonicalPath = `/movie/${activeProject.slug}${workspace === 'beat-map' ? '/beat-map' : ''}`
      if (route !== canonicalPath && (!routeSlug || !routeProject)) {
        window.history.replaceState({}, '', canonicalPath)
        setRoute(canonicalPath)
      }
    }
  }, [activeProject, activeProjectId, route, routeProject, routeSlug, workspace])

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setRoute(path)
    window.scrollTo(0, 0)
  }

  const openProject = (project: CreativeProject) => {
    setActiveProjectId(project.id)
    navigate(`/movie/${project.slug}`)
  }

  const openBeatMap = (project: CreativeProject) => {
    setActiveProjectId(project.id)
    navigate(`/movie/${project.slug}/beat-map`)
  }

  const createProject = (project: CreativeProject) => {
    setProjects((current) => [project, ...current])
    setActiveProjectId(project.id)
    navigate(`/movie/${project.slug}`)
  }

  const renameActiveProject = (title: string) => {
    setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, title, updatedAt: new Date().toISOString() } : project))
    if (activeProject.id === 'all-night-laundromat') localStorage.setItem('logfood:title', title)
  }

  if (!route.startsWith('/movie')) return <Dashboard projects={projects} onOpenProject={openProject} onOpenBeatMap={openBeatMap} onCreateProject={createProject} />

  return <main className="app">
    <header className="topbar movie-topbar">
      <button className="projects-link" onClick={() => navigate('/')} aria-label="Back to projects"><span aria-hidden="true">←</span> Projects</button>
      <input className="document-title-input" value={activeProject.title} onChange={(event) => renameActiveProject(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} aria-label="Project title" spellCheck={false} />
    </header>
    {workspace === 'beat-map' ? <BeatMap
      key={`${activeProject.id}:beat-map`}
      title={activeProject.title}
      initialScript={activeProject.id === 'all-night-laundromat' ? sampleScript : ''}
      storageKey={`logfood:project:${activeProject.id}`}
      migrateLegacy={activeProject.id === 'all-night-laundromat'}
      onOpenScreenplay={(sceneId) => { if (sceneId) localStorage.setItem(`logfood:project:${activeProject.id}:focus-scene`, sceneId); navigate(`/movie/${activeProject.slug}`) }}
    /> : <ScreenplayEditor
      key={activeProject.id}
      initialScript={activeProject.id === 'all-night-laundromat' ? sampleScript : ''}
      title={activeProject.title}
      onTitleChange={renameActiveProject}
      onOpenBeatMap={() => navigate(`/movie/${activeProject.slug}/beat-map`)}
      storageKey={`logfood:project:${activeProject.id}`}
      migrateLegacy={activeProject.id === 'all-night-laundromat'}
    />}
  </main>
}
