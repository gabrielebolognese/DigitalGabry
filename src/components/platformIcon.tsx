import { SiInstagram, SiX, SiYoutube } from "@icons-pack/react-simple-icons";
import type { ContentPlatform } from "../domain/content";
import type { IconComponent } from "./blockIcon";

/* Simple Icons dropped the LinkedIn mark and lucide v1 carries no brand icons,
   so nothing in the fixed stack resolves it. Through phase 10 that fell back to
   a generic glyph, which was tolerable on a block. Spec2 1.2 puts a brand mark
   on every content sub-tab, so the gap moved onto a primary navigation surface
   and had to be closed.

   One local path is the smallest fix: no new dependency, and no pinning
   @icons-pack to an older release for a single glyph. Drawn to match the other
   marks, which are solid rather than stroked, so it inherits currentColor and
   the 14px sizing class exactly as they do. */
function SiLinkedin({ className, ...rest }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} {...rest}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export const PLATFORM_ICONS: Record<ContentPlatform, IconComponent> = {
  x: SiX,
  linkedin: SiLinkedin,
  instagram: SiInstagram,
  youtube: SiYoutube,
};

export function iconForPlatform(platform: ContentPlatform): IconComponent {
  return PLATFORM_ICONS[platform];
}
