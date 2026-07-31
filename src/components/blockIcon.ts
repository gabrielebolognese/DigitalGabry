import type { ComponentType } from "react";
import {
  Calendar,
  CircleCheck,
  FileText,
  Flag,
  PenLine,
  Send,
  Target,
} from "lucide-react";
import {
  SiGithub,
  SiInstagram,
  SiTiktok,
  SiX,
  SiYoutube,
} from "@icons-pack/react-simple-icons";
import type { Block, BlockKind, Platform } from "../domain/block";

export type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean;
}>;

const KIND_ICONS: Record<BlockKind, IconComponent> = {
  task: CircleCheck,
  post: Send,
  event: Calendar,
  focus: Target,
  deadline: Flag,
  note: FileText,
};

/* SPEC 5.2 asks for a linkedin mark, but Simple Icons dropped LinkedIn and
   lucide v1 carries no brand icons, so there is nothing in the fixed stack to
   resolve it to. It falls through to the documented `post` fallback until the
   gap is settled. */
const PLATFORM_ICONS: Partial<Record<Platform, IconComponent>> = {
  x: SiX,
  youtube: SiYoutube,
  instagram: SiInstagram,
  tiktok: SiTiktok,
  github: SiGithub,
  blog: PenLine,
};

export function iconForBlock(block: Block): IconComponent {
  if (block.kind === "post" && block.payload.platform !== undefined) {
    const platformIcon = PLATFORM_ICONS[block.payload.platform];
    if (platformIcon !== undefined) return platformIcon;
  }
  return KIND_ICONS[block.kind];
}
