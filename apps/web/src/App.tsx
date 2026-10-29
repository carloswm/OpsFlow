import { useCallback, useEffect, useState, type FormEvent } from 'react'

type User = { id: string; displayName: string; email: string; role: 'member' | 'admin' }
type Service = { id: string; name: string; ownerTeam: string; criticality: string }
type Status = 'open' | 'acknowledged' | 'mitigating' | 'resolved'
type Incident = {
  id: string
  title: string
  description: string
  serviceId: string
  serviceName: string
  severity: 'P1' | 'P2' | 'P3' | 'P4'
  status: Status
  createdByName: string
  assigneeId?: string | null
  assigneeName?: string | null
  resolutionNote?: string | null
  openedAt: string
  updatedAt: string
}
type TimelineEntry = {
  id: string
  kind: 'event' | 'comment'
  actorName: string
  eventType: string
  body: string | null
  details: Record<string, unknown>
  createdAt: string
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }

  return body as T
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

const statusLabels: Record<Status, string> = {
  open: 'Abierto',
  acknowledged: 'Atendido',
  mitigating: 'En mitigación',
  resolved: 'Resuelto',
}

const eventLabels: Record<string, string> = {
  'incident.created': 'Incidente creado',
  'incident.status_changed': 'Cambio de estado',
  'incident.comment_added': 'Comentario agregado',
  'incident.comment': 'Comentario',
  'incident.assigned': 'Responsable actualizado',
}

export function App() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<{ incident: Incident; timeline: TimelineEntry[] } | null>(null)

  const loadDashboard = useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' })
    if (statusFilter) params.set('status', statusFilter)
    if (severityFilter) params.set('severity', severityFilter)

    const [incidentResult, serviceResult, userResult] = await Promise.all([
      api<{ incidents: Incident[] }>(`/api/v1/incidents?${params}`),
      api<{ services: Service[] }>('/api/v1/services'),
      api<{ users: User[] }>('/api/v1/users'),
    ])

    setIncidents(incidentResult.incidents)
    setServices(serviceResult.services)
    setUsers(userResult.users)
  }, [statusFilter, severityFilter])

  useEffect(() => {
    const controller = new AbortController()

    async function initialize() {
      try {
        await api('/health/ready', { signal: controller.signal })
        setReady(true)
        try {
          const session = await api<{ user: User }>('/api/v1/auth/me', { signal: controller.signal })
          setUser(session.user)
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return
          throw error
        }
      } catch {
        if (!controller.signal.aborted) setReady(false)
      }
    }

    void initialize()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!user) return
    void loadDashboard().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'No se pudo cargar el tablero')
    })
  }, [user, loadDashboard])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNotice('')
    const form = new FormData(event.currentTarget)

    try {
      const result = await api<{ user: User }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      })
      setUser(result.user)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    setBusy(true)
    try {
      await api('/api/v1/auth/logout', { method: 'POST' })
      setUser(null)
      setIncidents([])
      setSelected(null)
      setNotice('Sesión cerrada')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo cerrar la sesión')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const form = new FormData(event.currentTarget)

    try {
      await api('/api/v1/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          description: form.get('description'),
          serviceId: form.get('serviceId'),
          severity: form.get('severity'),
        }),
      })
      setShowCreate(false)
      setNotice('Incidente creado')
      await loadDashboard()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo crear el incidente')
    } finally {
      setBusy(false)
    }
  }

  async function openIncident(id: string) {
    try {
      const result = await api<{ incident: Incident; timeline: TimelineEntry[] }>(`/api/v1/incidents/${id}`)
      setSelected(result)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo abrir el incidente')
    }
  }

  async function advanceIncident() {
    if (!selected) return
    const nextStatus: Record<Status, Status> = {
      open: 'acknowledged',
      acknowledged: 'mitigating',
      mitigating: 'resolved',
      resolved: 'acknowledged',
    }
    const target = nextStatus[selected.incident.status]
    const reason = target === 'resolved'
      ? window.prompt('Escribe la nota de resolución:')
      : selected.incident.status === 'resolved'
        ? window.prompt('¿Por qué se reabre el incidente?')
        : undefined

    if ((target === 'resolved' || selected.incident.status === 'resolved') && !reason?.trim()) return
    setBusy(true)

    try {
      await api(`/api/v1/incidents/${selected.incident.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target, reason }),
      })
      await Promise.all([loadDashboard(), openIncident(selected.incident.id)])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo actualizar el estado')
    } finally {
      setBusy(false)
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const commentForm = event.currentTarget
    const form = new FormData(commentForm)
    const body = String(form.get('comment') ?? '').trim()
    if (!body) return
    setBusy(true)

    try {
      await api(`/api/v1/incidents/${selected.incident.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      await openIncident(selected.incident.id)
      commentForm.reset()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo agregar el comentario')
    } finally {
      setBusy(false)
    }
  }

  async function assignIncident(assigneeId: string) {
    if (!selected) return
    try {
      await api(`/api/v1/incidents/${selected.incident.id}/assignee`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: assigneeId || null }),
      })
      await Promise.all([loadDashboard(), openIncident(selected.incident.id)])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo actualizar el responsable')
    }
  }

  const activeCount = incidents.filter((incident) => incident.status !== 'resolved').length
  const criticalCount = incidents.filter((incident) => incident.severity === 'P1' && incident.status !== 'resolved').length

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="OpsFlow inicio">
          <span className="brand-mark" aria-hidden="true">O</span><span>opsflow</span>
        </a>
        <div className="topbar-actions">
          <span className="environment"><span className={`status-dot ${ready ? 'is-ready' : ''}`} />{ready ? 'Sistema operativo' : 'Conectando'}</span>
          {user && <><span className="user-name">{user.displayName}</span><button className="button button-quiet" disabled={busy} onClick={() => void handleLogout()}>Salir</button></>}
        </div>
      </header>

      {!ready && (
        <section className="empty-state"><div className="empty-icon">!</div><h1>Servicio no disponible</h1><p>La API o la base de datos todavía no están listas. Revisa el estado de los contenedores e intenta de nuevo.</p></section>
      )}

      {ready && !user && (
        <section className="login-layout">
          <div className="welcome login-welcome"><p className="eyebrow">CENTRO DE OPERACIONES</p><h1>Responde con claridad.</h1><p className="subtitle">Registra, asigna y sigue incidentes de servicio en un mismo lugar.</p></div>
          <form className="form-card login-card" onSubmit={(event) => void handleLogin(event)}>
            <p className="eyebrow">ACCESO DEL EQUIPO</p><h2>Iniciar sesión</h2>
            <label>Correo<input name="email" type="email" autoComplete="username" required maxLength={320} /></label>
            <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
            <button className="button button-primary button-full" disabled={busy}>{busy ? 'Ingresando…' : 'Entrar'}</button>
            {notice && <p className="notice" role="alert">{notice}</p>}
          </form>
        </section>
      )}

      {ready && user && (
        <>
          <section className="welcome dashboard-heading">
            <div><p className="eyebrow">CENTRO DE OPERACIONES</p><h1>Incidentes</h1><p className="subtitle">Visibilidad clara para responder y recuperar tus servicios.</p></div>
            <button className="button button-primary" onClick={() => setShowCreate(true)}>＋ Nuevo incidente</button>
          </section>

          {notice && <div className="notice-banner" role="status"><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice('')}>×</button></div>}

          <section className="stats-grid" aria-label="Resumen de incidentes">
            <article className="stat-card"><span>Incidentes activos</span><strong>{activeCount}</strong><small>En seguimiento por el equipo</small></article>
            <article className="stat-card stat-critical"><span>Severidad crítica</span><strong>{criticalCount}</strong><small>Prioridad inmediata</small></article>
            <article className="stat-card"><span>Servicios monitoreados</span><strong>{services.length}</strong><small>Con información operativa</small></article>
          </section>

          <section className="list-panel" aria-labelledby="incidents-title">
            <div className="panel-heading"><div><h2 id="incidents-title">Actividad reciente</h2><p>{incidents.length} incidentes encontrados</p></div>
              <div className="filters">
                <label className="visually-hidden" htmlFor="filter-status">Filtrar por estado</label>
                <select id="filter-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <label className="visually-hidden" htmlFor="filter-severity">Filtrar por severidad</label>
                <select id="filter-severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="">Todas las severidades</option>{['P1', 'P2', 'P3', 'P4'].map((value) => <option key={value}>{value}</option>)}</select>
              </div>
            </div>

            {incidents.length === 0 ? <div className="table-empty"><div className="empty-icon">✓</div><h3>Todo tranquilo por aquí</h3><p>Crea un incidente para empezar a coordinar la respuesta del equipo.</p></div> : (
              <div className="incident-list">{incidents.map((incident) => (
                <button className="incident-row" key={incident.id} onClick={() => void openIncident(incident.id)}>
                  <span className={`severity-mark severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span>
                  <span className="incident-main"><strong>{incident.title}</strong><small>{incident.serviceName} · Creado por {incident.createdByName}</small></span>
                  <span className={`status-pill status-${incident.status}`}>{statusLabels[incident.status]}</span>
                  <time dateTime={incident.updatedAt}>{formatDate(incident.updatedAt)}</time>
                </button>
              ))}</div>
            )}
          </section>
        </>
      )}

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false) }}>
        <form className="form-card modal-card" onSubmit={(event) => void handleCreateIncident(event)}>
          <div className="modal-heading"><div><p className="eyebrow">NUEVO REGISTRO</p><h2>Crear incidente</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setShowCreate(false)}>×</button></div>
          <label>Título<input name="title" required minLength={3} maxLength={200} placeholder="Ej. Errores al procesar pagos" /></label>
          <label>Servicio<select name="serviceId" required defaultValue=""><option value="" disabled>Selecciona un servicio</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.ownerTeam}</option>)}</select></label>
          <label>Severidad<select name="severity" defaultValue="P3"><option value="P1">P1 · Crítica</option><option value="P2">P2 · Alta</option><option value="P3">P3 · Media</option><option value="P4">P4 · Baja</option></select></label>
          <label>Descripción<textarea name="description" required minLength={5} maxLength={10000} rows={4} placeholder="Describe el impacto observado y lo que se conoce hasta ahora." /></label>
          <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setShowCreate(false)}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Guardando…' : 'Crear incidente'}</button></div>
        </form>
      </div>}

      {selected && <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
        <aside className="incident-drawer" aria-label={`Detalle: ${selected.incident.title}`}>
          <div className="drawer-top"><span className={`severity-mark severity-${selected.incident.severity.toLowerCase()}`}>{selected.incident.severity}</span><button className="icon-button" aria-label="Cerrar detalle" onClick={() => setSelected(null)}>×</button></div>
          <p className="eyebrow">{selected.incident.serviceName}</p><h2>{selected.incident.title}</h2><p className="drawer-description">{selected.incident.description}</p>
          <div className="drawer-meta"><span className={`status-pill status-${selected.incident.status}`}>{statusLabels[selected.incident.status]}</span><span>Abierto {formatDate(selected.incident.openedAt)}</span></div>
          <label className="assignee-field">Responsable<select value={selected.incident.assigneeId ?? ''} onChange={(event) => void assignIncident(event.target.value)}><option value="">Sin asignar</option>{users.map((teamUser) => <option key={teamUser.id} value={teamUser.id}>{teamUser.displayName}</option>)}</select></label>
          {selected.incident.resolutionNote && <div className="resolution-note"><strong>Nota de resolución anterior</strong><p>{selected.incident.resolutionNote}</p></div>}
          <button className="button button-secondary button-full" disabled={busy} onClick={() => void advanceIncident()}>{selected.incident.status === 'resolved' ? 'Reabrir incidente' : selected.incident.status === 'mitigating' ? 'Resolver incidente' : selected.incident.status === 'acknowledged' ? 'Iniciar mitigación' : 'Atender incidente'}</button>
          <section className="timeline-section"><h3>Línea de tiempo</h3><ol className="timeline">{selected.timeline.map((entry) => <li key={`${entry.kind}-${entry.id}`}><span className="timeline-dot" /><div><strong>{eventLabels[entry.eventType] ?? entry.eventType}</strong>{entry.body && <p>{entry.body}</p>}{typeof entry.details.reason === 'string' && <p>{entry.details.reason}</p>}<small>{entry.actorName} · {formatDate(entry.createdAt)}</small></div></li>)}</ol></section>
          <form className="comment-form" onSubmit={(event) => void addComment(event)}><label htmlFor="comment-input">Agregar comentario</label><textarea id="comment-input" name="comment" required minLength={2} maxLength={5000} rows={3} placeholder="Comparte una actualización con el equipo." /><button className="button button-primary" disabled={busy}>Comentar</button></form>
        </aside>
      </div>}
    </main>
  )
}
