import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "../../../components/Skeleton";
import { TEMPLATE_LABELS, TEMPLATES } from "./templates";
import {
  LINKEDIN_FORMATS,
  LINKEDIN_LAYOUTS,
  linkedInImageSpecSchema,
  type LinkedInFormat,
  type LinkedInImageSpec,
  type LinkedInLayout,
  type LinkedInPayload,
} from "../../../content/linkedin/schema";
import { generateSpec } from "../../../content/linkedin/generate";
import { promoteVariant, reRender, renderVariants, type Variant } from "../../../content/linkedin/pipeline";
import { readApiKey } from "../../../panel/apiKey";
import { resolveAssetUrl } from "../../../vault/vault";
import {
  STATUS_LABELS,
  statusesFor,
  type ContentItem,
  type ContentStatus,
} from "../../../domain/content";

/* Spec2 3.5. The editor, plus the generation strip beneath the body.

   Editing a spec field re-renders the preview with no API call, which is the
   whole reason the model returns JSON rather than an image: after generation
   you can fix a headline without paying for and waiting on another call, and
   without the layout drifting because the model chose differently this time. */

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type LinkedInEditorProps = {
  item: ContentItem;
  onPatch: (patch: Partial<ContentItem>) => Promise<void>;
  onClose: () => void;
};

export default function LinkedInEditor({ item, onPatch, onClose }: LinkedInEditorProps) {
  const payload = item.payload as LinkedInPayload;

  const [text, setText] = useState(item.body);
  const [format, setFormat] = useState<LinkedInFormat>(
    payload.format ?? "feature-spotlight",
  );
  const [spec, setSpec] = useState<LinkedInImageSpec | null>(payload.imageSpec ?? null);
  const [layout, setLayout] = useState<LinkedInLayout>(payload.templateId ?? "headline");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [checkedKey, setCheckedKey] = useState(false);

  useEffect(() => {
    void readApiKey().then((key) => {
      setApiKey(key);
      setCheckedKey(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pairs = await Promise.all(
        variants.map(
          async (variant) => [variant.asset.id, await resolveAssetUrl(variant.asset)] as const,
        ),
      );
      if (!cancelled) setThumbs(new Map(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [variants]);

  const generate = useCallback(async () => {
    if (apiKey === null) return;
    setBusy(true);
    setError(null);
    setRaw(null);

    try {
      const result = await generateSpec({
        apiKey,
        postText: text,
        format,
        ...(nudge.trim() === "" ? {} : { nudge }),
      });

      if (!result.ok) {
        /* Surfaced with the raw output for manual repair, never swallowed and
           never silently defaulted. Invariant 13. */
        setError(result.error);
        setRaw(result.raw);
        return;
      }

      setSpec(result.spec);
      setLayout(result.spec.layout);
      setVariants(await renderVariants(item, result.spec, result.promptHash, Date.now()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The generation failed");
    } finally {
      setBusy(false);
    }
  }, [apiKey, text, format, nudge, item]);

  /* Local only. No network, which is what makes fixing a headline instant. */
  const patchSpec = useCallback(
    (patch: Partial<LinkedInImageSpec>) => {
      if (spec === null) return;
      const next = { ...spec, ...patch };
      const validated = linkedInImageSpecSchema.safeParse(next);
      setSpec(next);
      setError(
        validated.success
          ? null
          : validated.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
      );
    },
    [spec],
  );

  const Preview = TEMPLATES[layout];

  return (
    <div
      role="dialog"
      aria-label="Edit LinkedIn post"
      className="scrim fixed inset-0 z-50 flex justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <aside className="li-editor flex h-full flex-col gap-3 overflow-y-auto border-l border-line bg-elevated p-3">
        <span className="text-title text-primary">LinkedIn post</span>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Text</span>
          <textarea
            rows={6}
            className={FIELD}
            value={text}
            aria-label="Post text"
            onChange={(event) => {
              setText(event.target.value);
              void onPatch({ body: event.target.value });
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Format"
            className={`${FIELD} w-auto`}
            value={format}
            onChange={(event) => {
              const next = event.target.value as LinkedInFormat;
              setFormat(next);
              void onPatch({ payload: { ...payload, format: next } });
            }}
          >
            {LINKEDIN_FORMATS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/-/g, " ")}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={busy || apiKey === null || text.trim() === ""}
            onClick={() => void generate()}
            className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
          >
            {spec === null ? "Generate image" : "Regenerate"}
          </button>

          <input
            className={`${FIELD} w-auto flex-1`}
            placeholder="Nudge, such as more technical"
            aria-label="Nudge"
            value={nudge}
            onChange={(event) => setNudge(event.target.value)}
          />
        </div>

        {checkedKey && apiKey === null && (
          <span className="text-meta text-tertiary">
            Add an Anthropic API key in Settings to generate images. Everything
            else here works without one.
          </span>
        )}

        {/* A surface block at the right aspect ratio, never a spinner.
            Spec2 3.5. */}
        {busy && <Skeleton className="li-preview w-full" />}

        {error !== null && (
          <div className="flex flex-col gap-1">
            <span className="text-meta text-cat-deadline">{error}</span>
            {raw !== null && (
              <textarea
                readOnly
                rows={5}
                aria-label="Raw model response"
                value={raw}
                className={`${FIELD} font-mono text-micro`}
              />
            )}
          </div>
        )}

        {variants.length > 0 && (
          <div className="flex items-center gap-2">
            {variants.map((variant) => (
              <button
                key={variant.asset.id}
                type="button"
                aria-label={`Use the ${TEMPLATE_LABELS[variant.layout]} layout`}
                onClick={() => {
                  setLayout(variant.layout);
                  void promoteVariant(item, variant);
                }}
                className={`motion-hover li-thumb overflow-hidden rounded-block border ${
                  variant.layout === layout ? "border-accent-border" : "border-hair"
                }`}
              >
                {thumbs.has(variant.asset.id) && (
                  <img
                    src={thumbs.get(variant.asset.id)}
                    alt={TEMPLATE_LABELS[variant.layout]}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {spec !== null && !busy && (
          <>
            {/* Live, local, and free. */}
            <div className="li-preview overflow-hidden rounded-block border border-hair">
              <div className="li-preview-scale">
                <Preview spec={spec} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-micro uppercase text-tertiary">Spec</span>

              <select
                aria-label="Template"
                className={FIELD}
                value={layout}
                onChange={(event) => setLayout(event.target.value as LinkedInLayout)}
              >
                {LINKEDIN_LAYOUTS.map((option) => (
                  <option key={option} value={option}>
                    {TEMPLATE_LABELS[option]}
                  </option>
                ))}
              </select>

              {/* Field by field, with the same limits enforced live, rather
                  than a raw JSON editor that can produce something the
                  renderer will not accept. Spec2 3.5. */}
              <input
                className={FIELD}
                aria-label="Eyebrow"
                placeholder="Eyebrow, 24 max"
                maxLength={24}
                value={spec.eyebrow ?? ""}
                onChange={(event) => patchSpec({ eyebrow: event.target.value })}
              />
              <input
                className={FIELD}
                aria-label="Headline"
                placeholder="Headline, 60 max"
                maxLength={60}
                value={spec.headline}
                onChange={(event) => patchSpec({ headline: event.target.value })}
              />
              <input
                className={FIELD}
                aria-label="Subheadline"
                placeholder="Subheadline, 90 max"
                maxLength={90}
                value={spec.subheadline ?? ""}
                onChange={(event) => patchSpec({ subheadline: event.target.value })}
              />
              <input
                className={FIELD}
                aria-label="Badge"
                placeholder="Badge, 16 max"
                maxLength={16}
                value={spec.badge ?? ""}
                onChange={(event) => patchSpec({ badge: event.target.value })}
              />

              <button
                type="button"
                onClick={() => void reRender(item, spec, layout, Date.now())}
                className="motion-hover self-start rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
              >
                Save this image
              </button>
            </div>
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Status</span>
          <select
            className={FIELD}
            value={item.status}
            onChange={(event) =>
              void onPatch({ status: event.target.value as ContentStatus })
            }
          >
            {statusesFor("linkedin").map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </aside>
    </div>
  );
}
