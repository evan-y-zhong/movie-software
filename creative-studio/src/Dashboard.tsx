import { useMemo, useState } from 'react'
import './Dashboard.css'

export type ProjectFormat = 'Feature film' | 'Short film' | 'Television' | 'Limited series' | 'Documentary' | 'Other'
export type ProjectAccent = 'rust' | 'olive' | 'slate' | 'ochre'
export type CreativeProject = {
  id: string
  slug: string
  title: string
  format: ProjectFormat
  updatedAt: string
  workspaces: string[]
  accent: ProjectAccent
}

const formats: ProjectFormat[] = ['Feature film', 'Short film', 'Television', 'Limited series', 'Documentary', 'Other']

const relativeDate = (date: string) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))
  if (days === 0) return 'Edited today'
  if (days === 1) return 'Edited yesterday'
  if (days < 7) return `Edited ${days} days ago`
  return `Edited ${new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function Dashboard({ projects, onOpenProject, onOpenBeatMap, onCreateProject }: { projects: CreativeProject[]; onOpenProject: (project: CreativeProject) => void; onOpenBeatMap: (project: CreativeProject) => void; onCreateProject: (project: CreativeProject) => void }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [creatingBeatMap, setCreatingBeatMap] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newFormat, setNewFormat] = useState<ProjectFormat>('Feature film')
  const [beatMapProjectId, setBeatMapProjectId] = useState(projects[0]?.id || '')
  const filteredProjects = useMemo(() => projects.filter((project) => `${project.title} ${project.format} ${project.workspaces.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [projects, query])

  const submitProject = (event: React.FormEvent) => {
    event.preventDefault()
    const title = newTitle.trim() || 'Untitled Project'
    const baseSlug = slugify(title) || 'untitled-project'
    let projectSlug = baseSlug
    let suffix = 2
    while (projects.some((project) => project.slug === projectSlug)) projectSlug = `${baseSlug}-${suffix++}`
    onCreateProject({
      id: `${projectSlug}-${Date.now().toString(36)}`,
      slug: projectSlug,
      title,
      format: newFormat,
      updatedAt: new Date().toISOString(),
      workspaces: ['Screenplay', 'Beat map'],
      accent: 'ochre',
    })
  }

  const submitBeatMap = (event: React.FormEvent) => {
    event.preventDefault()
    const project = projects.find((candidate) => candidate.id === beatMapProjectId)
    if (project) onOpenBeatMap(project)
  }

  return <div className="dashboard">
    <header className="dashboard-header">
      <div className="dashboard-brand">
        <span className="dashboard-brand-mark">L</span>
        <span><b>Logfood</b><small>Story studio</small></span>
      </div>
      <span className="dashboard-section">Projects</span>
    </header>

    <main className="dashboard-main">
      <section className="dashboard-heading">
        <div><span className="eyebrow">YOUR WORKSPACE</span><h1>Projects</h1><p>Every part of a story, together in one place.</p></div>
        <div className="dashboard-actions">
          <button className="new-beat-map-button" onClick={() => { setBeatMapProjectId(projects[0]?.id || ''); setCreatingBeatMap(true) }} disabled={!projects.length}><span>◇</span> Create beat map</button>
          <button className="new-project-button" onClick={() => setCreating(true)}><span>＋</span> New project</button>
        </div>
      </section>

      <section className="project-tools" aria-label="Project tools">
        <label className="project-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /></label>
        <span>{filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}</span>
      </section>

      <section className="project-grid" aria-label="Your projects">
        {filteredProjects.map((project) => <article className={`project-folder accent-${project.accent}`} key={project.id}>
          <span className="project-folder-tab" aria-hidden="true" />
          <button className="project-folder-summary" onClick={() => onOpenProject(project)} aria-label={`Open ${project.title} screenplay`}>
            <span className="project-folder-format">{project.format}</span>
            <h2>{project.title}</h2>
            <span className="project-folder-date">{relativeDate(project.updatedAt)}</span>
          </button>
          <div className="project-folder-contents">
            <span className="folder-contents-label">PROJECT FILES</span>
            <button className="project-file" onClick={() => onOpenProject(project)}>
              <span className="project-file-icon screenplay-file" aria-hidden="true"><i /><i /><i /></span>
              <span><b>Screenplay</b><small>Write and format the draft</small></span>
              <strong aria-hidden="true">→</strong>
            </button>
            <button className="project-file" onClick={() => onOpenBeatMap(project)}>
              <span className="project-file-icon beat-map-file" aria-hidden="true"><i /><i /><i /><i /></span>
              <span><b>Beat Map</b><small>Freeform and character views</small></span>
              <strong aria-hidden="true">→</strong>
            </button>
          </div>
        </article>)}
        <button className="empty-project-card" onClick={() => setCreating(true)}><span>＋</span><b>Start a new project</b><small>Film, series, documentary, or something else</small></button>
      </section>

      {!filteredProjects.length && <div className="no-projects"><span>⌕</span><h2>No projects found</h2><p>Try another title, format, or workspace.</p></div>}
    </main>

    {creating && <div className="dialog-backdrop" onMouseDown={() => setCreating(false)}>
      <form className="new-project-dialog" onSubmit={submitProject} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><span className="eyebrow">NEW PROJECT</span><h2>Set up your story</h2></div><button type="button" onClick={() => setCreating(false)} aria-label="Close">×</button></div>
        <label>Project title<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Untitled Project" /></label>
        <label>Format<select value={newFormat} onChange={(event) => setNewFormat(event.target.value as ProjectFormat)}>{formats.map((format) => <option key={format}>{format}</option>)}</select></label>
        <div className="included-workspaces"><span>INCLUDED WORKSPACES</span><div><b>Screenplay</b><b>Beat map</b></div><p>Write the draft and shape its story in connected workspaces.</p></div>
        <div className="dialog-actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button><button className="create-project" type="submit">Create project</button></div>
      </form>
    </div>}

    {creatingBeatMap && <div className="dialog-backdrop" onMouseDown={() => setCreatingBeatMap(false)}>
      <form className="new-project-dialog" onSubmit={submitBeatMap} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><span className="eyebrow">NEW BEAT MAP</span><h2>Choose a project</h2></div><button type="button" onClick={() => setCreatingBeatMap(false)} aria-label="Close">×</button></div>
        <p className="dialog-description">The beat map will start from the scenes in this project’s screenplay.</p>
        <label>Project<select autoFocus value={beatMapProjectId} onChange={(event) => setBeatMapProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <div className="dialog-actions"><button type="button" onClick={() => setCreatingBeatMap(false)}>Cancel</button><button className="create-project" type="submit">Create beat map</button></div>
      </form>
    </div>}
  </div>
}
