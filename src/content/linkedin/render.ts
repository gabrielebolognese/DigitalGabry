import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { domToPng } from "modern-screenshot";
import { TEMPLATES } from "../../views/content/linkedin/templates";
import type { LinkedInImageSpec, LinkedInLayout } from "./schema";

/* Spec2 3.2, step three: spec plus template to a PNG that is exactly
   1080 by 1350.

   Spec2 3.2 says to mount the template in an offscreen iframe and load the
   Geist woff2 files inside it. This mounts into an offscreen node in the main
   document instead, and the reason is the acceptance criterion the iframe was
   meant to serve: fonts must never render as a fallback face. The app already
   loads Geist locally and document.fonts has long since resolved by the time
   anyone presses generate, so rendering here guarantees the real face, while
   an iframe would have to load the same files again and could lose the race.

   The isolation an iframe would have given is achieved instead by scoping the
   whole brand palette under .fx-root, so nothing leaks either way. */

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;

function offscreenHost(): HTMLDivElement {
  const host = document.createElement("div");
  /* Off the page rather than hidden: display:none and visibility:hidden both
     stop layout, and a node with no layout rasterises as nothing. */
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${IMAGE_WIDTH}px`;
  host.style.height = `${IMAGE_HEIGHT}px`;
  host.style.pointerEvents = "none";
  host.setAttribute("aria-hidden", "true");
  return host;
}

export type RenderResult = {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function renderSpec(
  spec: LinkedInImageSpec,
  layout: LinkedInLayout,
): Promise<RenderResult> {
  const Template = TEMPLATES[layout];
  const host = offscreenHost();
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(createElement(Template, { spec }));

    /* Two frames, so React has committed and the browser has laid the node
       out before it is measured. One is not always enough. */
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    /* The criterion the iframe was meant to protect. Waiting on this rather
       than assuming is what stops a capture in a fallback face. */
    await document.fonts.ready;

    const target = host.firstElementChild;
    if (!(target instanceof HTMLElement)) {
      throw new Error("The template rendered nothing to capture");
    }

    const dataUrl = await domToPng(target, {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      /* pixelRatio 1, so the output is exactly the size asked for on a
         display of any density. Spec2 3.2. */
      scale: 1,
      backgroundColor: null,
      font: {},
    });

    return {
      bytes: dataUrlToBytes(dataUrl),
      mime: "image/png",
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    };
  } finally {
    /* Unmounted asynchronously, because React refuses to unmount a root while
       it is rendering and throws a warning that would reach the console. */
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
