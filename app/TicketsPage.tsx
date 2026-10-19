"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type TicketStatus = "open" | "in_progress" | "completed";
type Person = { id: string | number; displayName: string; role: string; isActive?: boolean };
type Client = { id: string | number; name: string; isActive?: boolean };
type Checkpoint = { id: string; label: string; completed: boolean; completedAt: string | null };
type Ticket = {
  id: string;
  title: string;
  description: string;
  assignedUserId: string;
  assignedUserName: string;
  clientId: string | null;
  clientName: string | null;
  status: TicketStatus;
  dueAt: string | null;
  assignmentUrl: string | null;
  completionUrl: string | null;
  completionUrlAddedAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  checkpoints: Checkpoint[];
};

const STATUS_COPY: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

function dueLabel(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function inputDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function TicketsPage({
  currentUser,
  users,
  clients,
}: {
  currentUser: Person;
  users: Person[];
  clients: Client[];
}) {
  const isAdmin = currentUser.role === "admin";
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<"active" | TicketStatus>("active");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignmentUrl, setAssignmentUrl] = useState("");
  const [completionDraft, setCompletionDraft] = useState("");
  const [checkpointDrafts, setCheckpointDrafts] = useState<string[]>([""]);
  const [newCheckpoint, setNewCheckpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await request<{ tickets: Ticket[] }>("/api/tickets");
      setTickets(result.tickets);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const visible = useMemo(() => tickets.filter((ticket) => {
    if (filter === "active") return ticket.status !== "completed";
    return ticket.status === filter;
  }), [filter, tickets]);

  const counts = useMemo(() => ({
    active: tickets.filter((ticket) => ticket.status !== "completed").length,
    open: tickets.filter((ticket) => ticket.status === "open").length,
    in_progress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    completed: tickets.filter((ticket) => ticket.status === "completed").length,
  }), [tickets]);

  function clearForm() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setAssigneeId(users.find((user) => user.isActive !== false && user.role !== "admin")?.id.toString() ?? "");
    setClientId("");
    setDueAt("");
    setAssignmentUrl("");
    setCheckpointDrafts([""]);
    setNewCheckpoint("");
  }

  function openCreate() {
    clearForm();
    setError("");
    setMessage("");
    setFormOpen(true);
  }

  function openEdit(ticket: Ticket) {
    setEditing(ticket);
    setTitle(ticket.title);
    setDescription(ticket.description);
    setAssigneeId(ticket.assignedUserId);
    setClientId(ticket.clientId ?? "");
    setDueAt(inputDate(ticket.dueAt));
    setAssignmentUrl("");
    setNewCheckpoint("");
    setError("");
    setMessage("");
    setFormOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        title,
        description,
        assignedUserId: assigneeId,
        clientId: clientId || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      };
      if (editing) {
        await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ...body, ticketId: editing.id, action: "update" }) });
        setMessage("Ticket updated.");
      } else {
        await request("/api/tickets", { method: "POST", body: JSON.stringify({ ...body, assignmentUrl: assignmentUrl || null, checkpoints: checkpointDrafts }) });
        setMessage("Ticket created and the team member was notified.");
      }
      setFormOpen(false);
      clearForm();
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(ticket: Ticket, status: TicketStatus) {
    setBusy(true);
    setError("");
    try {
      await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ticketId: ticket.id, action: "status", status }) });
      await load();
    } catch (statusError) {
      setError((statusError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCheckpoint(ticket: Ticket, checkpoint: Checkpoint) {
    setBusy(true);
    setError("");
    try {
      await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ticketId: ticket.id, action: "toggle_checkpoint", checkpointId: checkpoint.id, completed: !checkpoint.completed }) });
      await load();
    } catch (checkpointError) {
      setError((checkpointError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addCheckpoint(ticket: Ticket) {
    if (!newCheckpoint.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ticketId: ticket.id, action: "add_checkpoint", label: newCheckpoint }) });
      setNewCheckpoint("");
      await load();
    } catch (checkpointError) {
      setError((checkpointError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCheckpoint(ticket: Ticket, checkpoint: Checkpoint) {
    setBusy(true);
    try {
      await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ticketId: ticket.id, action: "delete_checkpoint", checkpointId: checkpoint.id }) });
      await load();
    } catch (checkpointError) {
      setError((checkpointError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`Delete “${ticket.title}”? Its history will be preserved.`)) return;
    setBusy(true);
    try {
      await request("/api/tickets", { method: "DELETE", body: JSON.stringify({ ticketId: ticket.id }) });
      if (expanded === ticket.id) setExpanded(null);
      await load();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCompletionLink(ticket: Ticket) {
    if (!completionDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/tickets", { method: "PATCH", body: JSON.stringify({ ticketId: ticket.id, action: "add_completion_link", completionUrl: completionDraft }) });
      setCompletionDraft("");
      setMessage(ticket.completionUrl ? "Completion link updated." : "Completion link submitted.");
      await load();
    } catch (linkError) {
      setError((linkError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tickets-page">
      <header className="tickets-heading">
        <div>
          <span className="eyebrow">Team workflow</span>
          <h1>{isAdmin ? "Tickets" : "My tickets"}</h1>
          <p>{isAdmin ? "Assign focused work and follow progress without unnecessary complexity." : "Your assigned work, deadlines, and checkpoints in one place."}</p>
        </div>
        <div className="ticket-heading-actions">
          <button className="button" type="button" disabled={loading} onClick={() => void load()}>↻ Refresh</button>
          {isAdmin && <button className="button button-primary" type="button" onClick={openCreate}><span>＋</span> New ticket</button>}
        </div>
      </header>

      <nav className="ticket-filters" aria-label="Ticket filters">
        {(["active", "open", "in_progress", "completed"] as const).map((value) => (
          <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            <span>{value === "active" ? "Active" : STATUS_COPY[value]}</span><b>{counts[value]}</b>
          </button>
        ))}
      </nav>

      {error && <div className="form-error ticket-feedback">{error}</div>}
      {message && <div className="form-success ticket-feedback">{message}</div>}

      {loading ? (
        <div className="ticket-empty"><span className="ticket-loader" /><strong>Loading tickets…</strong></div>
      ) : visible.length === 0 ? (
        <div className="ticket-empty"><span>✓</span><strong>No tickets here</strong><p>{filter === "active" ? "The active queue is clear." : `There are no ${filter.replace("_", " ")} tickets.`}</p></div>
      ) : (
        <div className="ticket-list">
          {visible.map((ticket) => {
            const done = ticket.checkpoints.filter((checkpoint) => checkpoint.completed).length;
            const overdue = Boolean(ticket.dueAt && ticket.status !== "completed" && new Date(ticket.dueAt) < new Date());
            const isExpanded = expanded === ticket.id;
            return <article className={`ticket-card status-${ticket.status} ${isExpanded ? "expanded" : ""}`} key={ticket.id}>
              <button className="ticket-summary" type="button" onClick={() => { setExpanded(isExpanded ? null : ticket.id); setCompletionDraft(isExpanded ? "" : ticket.completionUrl ?? ""); }} aria-expanded={isExpanded}>
                <span className={`ticket-status-dot ${ticket.status}`} />
                <span className="ticket-main-copy"><strong>{ticket.title}</strong><small>{ticket.clientName || "Internal task"} · {ticket.assignedUserName}</small></span>
                <span className={`ticket-due ${overdue ? "overdue" : ""}`}>{overdue ? "Overdue · " : ""}{dueLabel(ticket.dueAt)}</span>
                <span className="ticket-progress">{ticket.checkpoints.length ? `${done}/${ticket.checkpoints.length}` : "No checkpoints"}</span>
                <span className="ticket-chevron">⌄</span>
              </button>
              {isExpanded && <div className="ticket-detail">
                <div className="ticket-detail-grid">
                  <div className="ticket-description"><span>Description</span><p>{ticket.description || "No description was added."}</p></div>
                  <label className="ticket-manual-status"><span>Status · changed manually</span><select value={ticket.status} disabled={busy} onChange={(event) => void changeStatus(ticket, event.target.value as TicketStatus)}>{Object.entries(STATUS_COPY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </div>
                {(ticket.assignmentUrl || ticket.completionUrl) && <section className="ticket-links">
                  {ticket.assignmentUrl && <div><span>Assignment link <small>Locked</small></span><a href={ticket.assignmentUrl} target="_blank" rel="noreferrer">Open reference ↗</a></div>}
                  {ticket.completionUrl && <div><span>Completion link <small>Submitted</small></span><a href={ticket.completionUrl} target="_blank" rel="noreferrer">View completed work ↗</a></div>}
                </section>}
                <section className="ticket-checkpoints">
                  <header><div><strong>Checkpoints</strong><small>Optional guidance — they never change ticket status.</small></div>{ticket.checkpoints.length > 0 && <span>{done} of {ticket.checkpoints.length}</span>}</header>
                  {ticket.checkpoints.length === 0 ? <p className="checkpoint-empty">This ticket has no checkpoints. It can still be completed normally.</p> : <div className="checkpoint-list">{ticket.checkpoints.map((checkpoint) => <div className={checkpoint.completed ? "done" : ""} key={checkpoint.id}><label><input type="checkbox" checked={checkpoint.completed} disabled={busy} onChange={() => void toggleCheckpoint(ticket, checkpoint)} /><span>{checkpoint.label}</span></label>{isAdmin && <button type="button" onClick={() => void deleteCheckpoint(ticket, checkpoint)} aria-label={`Delete ${checkpoint.label}`}>×</button>}</div>)}</div>}
                  {isAdmin && <div className="checkpoint-add"><input value={newCheckpoint} maxLength={240} onChange={(event) => setNewCheckpoint(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCheckpoint(ticket); } }} placeholder="Add a checkpoint" /><button type="button" disabled={busy || !newCheckpoint.trim()} onClick={() => void addCheckpoint(ticket)}>Add</button></div>}
                </section>
                {String(ticket.assignedUserId) === String(currentUser.id) && ticket.status === "completed" && <section className="ticket-completion-link"><div><strong>{ticket.completionUrl ? "Update completed work" : "Add completed work"}</strong><small>Optional. Add the final work link after manually completing the ticket.</small></div><div><input type="url" value={completionDraft} onChange={(event) => setCompletionDraft(event.target.value)} placeholder="https://…" /><button type="button" disabled={busy || !completionDraft.trim()} onClick={() => void submitCompletionLink(ticket)}>{ticket.completionUrl ? "Update link" : "Submit link"}</button></div></section>}
                <footer className="ticket-detail-footer"><small>Created by {ticket.createdByName} · {dueLabel(ticket.createdAt)}</small>{isAdmin && <div><button type="button" onClick={() => openEdit(ticket)}>Edit ticket</button><button className="danger" type="button" onClick={() => void deleteTicket(ticket)}>Delete</button></div>}</footer>
              </div>}
            </article>;
          })}
        </div>
      )}

      {formOpen && isAdmin && <div className="ticket-modal-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setFormOpen(false); }}>
        <form className="ticket-form" onSubmit={save}>
          <header><div><span className="eyebrow">{editing ? "Ticket details" : "New assignment"}</span><h2>{editing ? "Edit ticket" : "Create ticket"}</h2></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close">×</button></header>
          <label><span>Ticket name</span><input autoFocus required maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" /></label>
          <label><span>Description</span><textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add the context the team member needs…" /></label>
          <div className="ticket-form-row">
            <label><span>Assign to</span><select required value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Choose member</option>{users.filter((person) => person.isActive !== false).map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
            <label><span>Client <small>optional</small></span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Internal task</option>{clients.filter((client) => client.isActive !== false).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          </div>
          <label><span>Due date <small>optional</small></span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          {!editing && <label><span>Assignment link <small>optional · locked after creation</small></span><input type="url" maxLength={2048} value={assignmentUrl} onChange={(event) => setAssignmentUrl(event.target.value)} placeholder="https://…" /></label>}
          {!editing && <fieldset className="ticket-checkpoint-builder"><legend>Checkpoints <small>optional</small></legend><p>Useful milestones only. Completing them will not change the ticket status.</p>{checkpointDrafts.map((checkpoint, index) => <div key={index}><input maxLength={240} value={checkpoint} onChange={(event) => setCheckpointDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Checkpoint ${index + 1}`} />{checkpointDrafts.length > 1 && <button type="button" onClick={() => setCheckpointDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}<button className="checkpoint-builder-add" type="button" onClick={() => setCheckpointDrafts((items) => [...items, ""])}>＋ Add checkpoint</button></fieldset>}
          {error && <div className="form-error">{error}</div>}
          <footer><button className="button" type="button" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create & notify"}</button></footer>
        </form>
      </div>}
    </section>
  );
}
