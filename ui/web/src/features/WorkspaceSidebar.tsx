import * as Dialog from "@radix-ui/react-dialog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement
} from "react";
import {
  FolderKanban,
  FolderPlus,
  PanelsTopLeft,
  Search,
  Settings2,
  X
} from "lucide-react";

import type {
  UiAction,
  UiRecentProject,
  UiWorkspaceProject,
  UiWorkspaceState
} from "../../../../src/types/ui.js";
import { Badge, Button, NoticeBanner } from "../components/ui.js";
import { formatTime } from "./format.js";
import type { ConnectionState } from "../state/usePortalSession.js";

export function WorkspaceSidebar(props: {
  activeView: "thread" | "settings";
  canOpenProject: boolean;
  connectionState: ConnectionState;
  mobileOpen: boolean;
  onAction(action: UiAction): Promise<boolean>;
  onCloseMobile(): void;
  workspace: UiWorkspaceState;
}): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectPathDraft, setProjectPathDraft] = useState("");
  const [query, setQuery] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const previousActiveThreadIdRef = useRef(props.workspace.activeThreadId);
  const filteredProjects = useMemo(
    () => filterProjects(props.workspace.projects, query),
    [props.workspace.projects, query]
  );

  const recentProjects = props.workspace.recentProjects.slice(0, 8);

  useEffect(() => {
    if (
      dialogOpen &&
      previousActiveThreadIdRef.current &&
      props.workspace.activeThreadId &&
      previousActiveThreadIdRef.current !== props.workspace.activeThreadId
    ) {
      setDialogOpen(false);
      setProjectPathDraft("");
      setSubmitError(null);
    }
    previousActiveThreadIdRef.current = props.workspace.activeThreadId;
  }, [dialogOpen, props.workspace.activeThreadId]);

  async function submitProjectLaunch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitError(null);

    const accepted = await props.onAction({
      type: "launch_project_thread",
      projectPath: projectPathDraft
    });
    if (!accepted) {
      setSubmitError("PI Dual could not start the new thread. Check the banner for details.");
      return;
    }

    setDialogOpen(false);
    setProjectPathDraft("");
    setSubmitError(null);
  }

  return (
    <>
      <aside className="workspace-sidebar" data-mobile-open={props.mobileOpen ? "true" : "false"}>
        <div className="workspace-sidebar__surface">
          <header className="workspace-sidebar__brand">
            <div className="workspace-brand">
              <span className="workspace-brand__mark">
                <PanelsTopLeft />
              </span>
              <div>
                <div className="workspace-eyebrow">PI Dual</div>
                <h1>Local Workspace</h1>
              </div>
            </div>
            <button
              aria-label="Close workspace sidebar"
              className="workspace-sidebar__close"
              type="button"
              onClick={props.onCloseMobile}
            >
              <X />
            </button>
          </header>

          <label className="workspace-search">
            <Search />
            <input
              aria-label="Filter local threads"
              placeholder="Filter projects or threads"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="workspace-sidebar__actions">
            <Button
              disabled={!props.canOpenProject}
              icon={<FolderPlus />}
              tone="accent"
              variant="primary"
              onClick={() => {
                setSubmitError(null);
                setDialogOpen(true);
              }}
            >
              Open Project
            </Button>
          </div>

          <div className="workspace-sidebar__meta">
            <Badge tone={props.connectionState === "connected" ? "success" : "warning"}>
              {props.workspace.threads.length} local threads
            </Badge>
          </div>

          <div className="workspace-sidebar__projects">
            {filteredProjects.length === 0 ? (
              <div className="workspace-empty">
                <h3>No matching threads</h3>
                <p>The sidebar lists saved local threads. Use Open Project to start work in another directory.</p>
              </div>
            ) : (
              filteredProjects.map((project) => (
                <ProjectSection
                  key={project.id}
                  onAction={props.onAction}
                  project={project}
                  selectedThreadId={props.workspace.selectedThreadId}
                />
              ))
            )}
          </div>

          <div className="workspace-sidebar__footer">
            <Button
              tone={props.activeView === "settings" ? "accent" : "neutral"}
              variant={props.activeView === "settings" ? "primary" : "secondary"}
              icon={<Settings2 />}
              onClick={() => {
                void props.onAction({
                  type: "open_settings"
                });
              }}
            >
              Settings
            </Button>
          </div>
        </div>
        <button
          aria-hidden={!props.mobileOpen}
          className="workspace-sidebar__backdrop"
          tabIndex={props.mobileOpen ? 0 : -1}
          type="button"
          onClick={props.onCloseMobile}
        />
      </aside>

      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setSubmitError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-backdrop" />
          <Dialog.Content
            aria-describedby="project-launcher-description"
            className="project-launcher-dialog"
          >
            <header className="drawer-header">
              <div>
                <div className="section-kicker">Local Launcher</div>
                <Dialog.Title className="drawer-title">Open Project</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="Close project launcher"
                  className="icon-button"
                  data-tone="neutral"
                  type="button"
                >
                  <X />
                </button>
              </Dialog.Close>
            </header>

            <form className="project-launcher-form" onSubmit={(event) => void submitProjectLaunch(event)}>
              <Dialog.Description className="project-launcher__description" id="project-launcher-description">
                Start a new live thread in another directory. The current live thread will move into history.
              </Dialog.Description>

              {submitError ? <NoticeBanner tone="error">{submitError}</NoticeBanner> : null}

              <label className="project-launcher__field">
                <span>Project path</span>
                <input
                  aria-label="Project path"
                  autoFocus
                  placeholder="/Users/Taylor/Sites/print-for-me"
                  value={projectPathDraft}
                  onChange={(event) => setProjectPathDraft(event.target.value)}
                />
              </label>

              {recentProjects.length > 0 ? (
                <section className="project-launcher__recent">
                  <div className="project-launcher__recent-header">
                    <h3>Recent Projects</h3>
                    <span>Reuse a recent local directory</span>
                  </div>
                  <div className="project-launcher__recent-list">
                    {recentProjects.map((project) => (
                      <RecentProjectButton
                        key={project.path}
                        project={project}
                        onClick={() => {
                          setProjectPathDraft(project.path);
                          setSubmitError(null);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="project-launcher__actions">
                <Button
                  disabled={!projectPathDraft.trim() || !props.canOpenProject}
                  icon={<FolderPlus />}
                  tone="accent"
                  type="submit"
                  variant="primary"
                >
                  Start New Thread
                </Button>
                <Dialog.Close asChild>
                  <Button variant="secondary">Cancel</Button>
                </Dialog.Close>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ProjectSection(props: {
  onAction(action: UiAction): Promise<boolean>;
  project: UiWorkspaceProject;
  selectedThreadId?: string | undefined;
}): ReactElement {
  return (
    <section className="workspace-project">
      <div className="workspace-project__header">
        <div className="workspace-project__title">
          <FolderKanban />
          <div>
            <strong>{props.project.projectName}</strong>
            <span>{props.project.projectPath}</span>
          </div>
        </div>
        <Badge>{props.project.threads.length}</Badge>
      </div>
      <div className="workspace-thread-list">
        {props.project.threads.map((thread) => (
          <button
            key={thread.threadId}
            className="workspace-thread-button"
            data-selected={thread.threadId === props.selectedThreadId ? "true" : "false"}
            type="button"
            onClick={() => {
              void props.onAction({
                type: "select_thread",
                threadId: thread.threadId
              });
            }}
          >
            <div className="workspace-thread-button__title">
              <span>{thread.title}</span>
              {thread.isActive ? <Badge tone="accent">Live</Badge> : null}
            </div>
            <div className="workspace-thread-button__meta">
              <span>{thread.latestStatus}</span>
              <span>{formatTime(thread.updatedAt)}</span>
            </div>
            {thread.latestSummary ? (
              <p>{thread.latestSummary}</p>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function RecentProjectButton(props: {
  onClick(): void;
  project: UiRecentProject;
}): ReactElement {
  return (
    <button className="project-launcher__recent-item" type="button" onClick={props.onClick}>
      <strong>{props.project.name}</strong>
      <span>{props.project.path}</span>
      <time dateTime={props.project.lastOpenedAt}>
        Last opened {formatRecentProjectTimestamp(props.project.lastOpenedAt)}
      </time>
    </button>
  );
}

function filterProjects(projects: UiWorkspaceProject[], query: string): UiWorkspaceProject[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return projects;
  }

  return projects
    .map((project) => ({
      ...project,
      threads: project.threads.filter((thread) =>
        [project.projectName, project.projectPath, thread.title, thread.latestSummary]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalized))
      )
    }))
    .filter((project) => project.threads.length > 0);
}

function formatRecentProjectTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}
