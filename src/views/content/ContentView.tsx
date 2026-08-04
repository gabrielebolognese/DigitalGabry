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
import XEditor from "./x/XEditor";
import LinkedInEditor from "./linkedin/LinkedInEditor";
import InstagramEditor from "./instagram/InstagramEditor";
import ContentEditor from "./ContentEditor";
import { sendToPhone } from "../../content/postThis";
import { formatScriptForFilming } from "../../domain/instagram";
import Toast from "../../components/Toast";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyImageInstead, postThis } from "../../content/postThis";
import { markPosted } from "../../content/linkToBlock";
import { assetsForContent } from "../../db/repository";
import { resolveAssetUrl } from "../../vault/vault";
import { DEFAULT_SOFT_LIMIT } from "../../domain/xPost";
import { readBackupSettings } from "../../backup/run";
import type { Asset } from "../../domain/content";
import { DEFAULT_TZ } from "../../domain/time";

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

  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [toast, setToast] = useState<{ message: string; asset: Asset | null } | null>(
    null,
  );
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [softLimit, setSoftLimit] = useState(DEFAULT_SOFT_LIMIT);

  useEffect(() => {
    void readBackupSettings().then((settings) => {
      const stored = (settings as { xSoftLimit?: number }).xSoftLimit;
      if (typeof stored === "number" && stored > 0) setSoftLimit(stored);
    });
  }, []);

  /* Thumbnails resolve asynchronously, so the grid gets them as a map rather
     than each card reaching for the disk on its own. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const pairs = await Promise.all(
        api.items.map(async (item) => {
          const linked = await assetsForContent(item.id);
          const primary = linked.find((entry) => entry.role === "primary");
          return primary === undefined
            ? null
            : ([item.id, await resolveAssetUrl(primary)] as const);
        }),
      );
      if (cancelled) return;
      setThumbnails(new Map(pairs.filter((pair): pair is [string, string] => pair !== null)));
    })();

    return () => {
      cancelled = true;
    };
  }, [api.items]);

  const open = useCallback((item: ContentItem) => setEditing(item), []);

  const primaryAssetOf = useCallback(async (item: ContentItem) => {
    const linked = await assetsForContent(item.id);
    return linked.find((entry) => entry.role === "primary") ?? null;
  }, []);

  const runPostThis = useCallback(
    async (item: ContentItem) => {
      const asset = await primaryAssetOf(item);
      const result = await postThis({ item, asset, nowUtc: Date.now(), tz: DEFAULT_TZ });

      setToast({
        message: result.imageStaged
          ? "Text copied, image ready in outbox"
          : "Text copied",
        asset,
      });

      /* Spec2 2.5: a prompt to mark it posted, a minute later, when the
         posting has actually had time to happen. */
      window.setTimeout(() => {
        setToast({ message: "Did that go out? Mark it posted", asset: null });
      }, 60_000);
    },
    [primaryAssetOf],
  );

  /* Spec2 4.3: the editor replaces the grid for this platform only, rather
     than sitting over it as an overlay, because a script needs the width. */
  if (editing !== null && editing.platform === "instagram") {
    return (
      <InstagramEditor
        item={editing}
        onPatch={async (patch) => {
          await api.patchItem(editing.id, patch);
          setEditing({ ...editing, ...patch });
        }}
        onSendToPhone={(payload) => {
          void sendToPhone(
            editing,
            formatScriptForFilming(payload, editing.title),
            Date.now(),
            DEFAULT_TZ,
          ).then(() => setToast({ message: "Script copied and staged", asset: null }));
        }}
        onClose={() => setEditing(null)}
      />
    );
  }

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
        imageUrlFor={(item) => thumbnails.get(item.id) ?? null}
        softLimitDefault={softLimit}
        onCopy={(item) => {
          void writeText(item.body === "" ? item.title : item.body);
          setToast({ message: "Text copied", asset: null });
        }}
        onPostThis={(item) => void runPostThis(item)}
      />

      {editing !== null && editing.platform === "linkedin" && (
        <LinkedInEditor
          item={editing}
          onPatch={async (patch) => {
            await api.patchItem(editing.id, patch);
            setEditing({ ...editing, ...patch });
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* The default, not a case. Anything without an editor of its own gets
          the shared one, so adding a platform needs no line here and YouTube
          is not named: "zero platform specific code paths", literally. */}
      {editing !== null &&
        editing.platform !== "x" &&
        editing.platform !== "linkedin" && (
        <ContentEditor
          item={editing}
          platform={editing.platform}
          projects={projects}
          onPatch={async (patch) => {
            await api.patchItem(editing.id, patch);
            setEditing({ ...editing, ...patch });
          }}
          onChanged={api.refresh}
          onClose={() => setEditing(null)}
        />
      )}

      {editing !== null && editing.platform === "x" && (
        <XEditor
          item={editing}
          softLimitDefault={softLimit}
          onPatch={async (patch) => {
            await api.patchItem(editing.id, patch);
            setEditing({ ...editing, ...patch });
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {toast !== null && (
        <Toast
          message={toast.message}
          action={{
            /* Both paths have to exist: the clipboard cannot usefully serve
               text and an image to the same paste, so taking the image means
               giving up the text and the choice is the user's. Spec2 2.4. */
            label: toast.asset === null ? "Mark posted" : "Copy image instead",
            onAct: () => {
              if (toast.asset !== null) {
                void copyImageInstead(toast.asset);
              } else if (editing !== null) {
                void markPosted(editing.id, { nowUtc: Date.now() }).then(api.refresh);
              }
              setToast(null);
            },
          }}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
