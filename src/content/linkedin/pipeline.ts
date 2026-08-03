import { importAsset } from "../../vault/vault";
import { linkAsset, updateContentItem } from "../../db/repository";
import { renderSpec } from "./render";
import { templatesFor, type LinkedInImageSpec, type LinkedInLayout, type LinkedInPayload } from "./schema";
import type { Asset, ContentItem } from "../../domain/content";

/* Spec2 3.2, the last two steps: rasterise, hash into the vault, and link.

   Three variants come from one API call, because the same spec renders through
   three templates. That is most of the reason the model returns JSON rather
   than an image. */

export type Variant = {
  layout: LinkedInLayout;
  asset: Asset;
};

export async function renderVariants(
  item: ContentItem,
  spec: LinkedInImageSpec,
  promptHash: string,
  nowUtc: number,
): Promise<Variant[]> {
  const layouts = templatesFor(spec);
  const variants: Variant[] = [];

  for (const layout of layouts) {
    const rendered = await renderSpec(spec, layout);
    const { asset } = await importAsset({
      bytes: rendered.bytes,
      mime: rendered.mime,
      folder: "linkedin",
      origin: "generated",
      nowUtc,
    });
    await linkAsset(item.id, asset.id, "variant", variants.length);
    variants.push({ layout, asset });
  }

  /* Everything needed to reproduce the image, stored beside it. Invariant 14:
     the spec that produced it, the prompt it came from, and which template
     rendered it, so the same picture can be made again or re-rendered through
     a different template later. */
  const payload: LinkedInPayload = {
    ...(item.payload as LinkedInPayload),
    imageSpec: spec,
    promptHash,
    templateId: variants[0]?.layout,
    generatedAt: nowUtc,
    lastRawResponse: undefined,
  };
  await updateContentItem(item.id, { payload: payload as Record<string, unknown> });

  return variants;
}

/* Promoting a variant is a role change, not a re-render: the bytes are already
   in the vault and identical. */
export async function promoteVariant(
  item: ContentItem,
  variant: Variant,
): Promise<void> {
  await linkAsset(item.id, variant.asset.id, "primary");
  await updateContentItem(item.id, {
    payload: {
      ...(item.payload as LinkedInPayload),
      templateId: variant.layout,
    } as Record<string, unknown>,
  });
}

/* Re-rendering after a field edit costs no API call, which is the whole point
   of storing the spec rather than only the image. Spec2 3.5. */
export async function reRender(
  item: ContentItem,
  spec: LinkedInImageSpec,
  layout: LinkedInLayout,
  nowUtc: number,
): Promise<Asset> {
  const rendered = await renderSpec(spec, layout);
  const { asset } = await importAsset({
    bytes: rendered.bytes,
    mime: rendered.mime,
    folder: "linkedin",
    origin: "generated",
    nowUtc,
  });
  await linkAsset(item.id, asset.id, "primary");

  await updateContentItem(item.id, {
    payload: {
      ...(item.payload as LinkedInPayload),
      imageSpec: spec,
      templateId: layout,
      generatedAt: nowUtc,
    } as Record<string, unknown>,
  });

  return asset;
}
