import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { iconForPlatform } from "../../components/platformIcon";
import {
  CONTENT_PLATFORMS,
  PLATFORM_LABELS,
  type ContentItem,
  type ContentPlatform,
} from "../../domain/content";
import { listProjects, type Project } from "../../db/repository";
import { useContent } from "../../store/useContent";
import { useUiStore } from "../../store/useUiStore";
import ContentGrid from "./ContentGrid";

/* Spec2 1.2. One rail item with sub-tabs rather than four rail items, which
   would dilute the rail and break the density rule in SPEC 3.6. */

const ACTIVE_TAB_KEY = "digitalgabry.content-platform";

function readActiveTab(): ContentPlatform {
  const stored = window.localStorage.getItem(ACTIVE_TAB_KEY);
  return CONTENT_PLATFORMS.find((platform) => platform === stored) ?? "x";
}

export default function ContentView() {
  const [platform, setPlatform] = useState<ContentPlatform>(readActiveTab);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const api = useContent(platform);
  const { contentReveal } = useUiStore();

  /* The palette can pick an item on any tab, so choosing one has to bring its
     tab forward before the grid can show it. */
  useEffect(() => {
    if (contentReveal === null) return;
    const target = CONTENT_PLATFORMS.find(
      (candidate) => candidate === contentReveal.platform,
    );
    if (target !== undefined) setPlatform(target);
  }, [contentReveal]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_KEY, platform);
  }, [platform]);

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  const create = useCallback(() => {
    void api.createItem(platform);
  }, [api, platform]);

  /* Phase 11 builds no platform editor, so opening a card has nowhere to go
     yet. Phases 12 to 15 replace this. */
  const open = useCallback((_item: ContentItem) => undefined, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-2 border-b border-hair px-3">
        <span className="text-title text-primary">Content</span>

        <div
          role="tablist"
          aria-label="Platform"
          className="flex items-center gap-1"
        >
          {CONTENT_PLATFORMS.map((id) => {
            const Icon = iconForPlatform(id);
            const active = id === platform;
            const count = api.counts[id];

            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPlatform(id)}
                className={`motion-hover flex items-center gap-1 rounded-control px-2 py-1 text-micro uppercase ${
                  active
                    ? "bg-selected text-primary"
                    : "text-tertiary hover:bg-hover hover:text-secondary"
                }`}
              >
                <Icon className="icon-content shrink-0" aria-hidden />
                {PLATFORM_LABELS[id]}
                {count > 0 && <span className="text-tertiary">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={create}
          aria-label={`New ${PLATFORM_LABELS[platform]} item`}
          className="motion-hover flex items-center gap-1 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
        >
          <Plus className="icon-content shrink-0" aria-hidden />
          New
        </button>
      </header>

      <ContentGrid
        api={api}
        platform={platform}
        projects={projects}
        onOpen={open}
      />
    </div>
  );
}
