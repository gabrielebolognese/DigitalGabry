import {
  BookOpen,
  Bug,
  Dumbbell,
  FileUser,
  Package,
  PenLine,
  Rocket,
  Send,
} from "lucide-react";
import {
  SiGithub,
  SiInstagram,
  SiTiktok,
  SiX,
  SiYoutube,
} from "@icons-pack/react-simple-icons";
import type { IconComponent } from "./blockIcon";

/* activity_types.icon holds a name, not a component, because the row has to
   survive in the database without knowing about the icon libraries.
   linkedin resolves to the generic send mark for the same reason it does in
   blockIcon: neither Simple Icons nor lucide ships one any more. */
const ACTIVITY_ICONS: Record<string, IconComponent> = {
  x: SiX,
  youtube: SiYoutube,
  instagram: SiInstagram,
  tiktok: SiTiktok,
  github: SiGithub,
  "pen-line": PenLine,
  package: Package,
  rocket: Rocket,
  bug: Bug,
  send: Send,
  "file-user": FileUser,
  "book-open": BookOpen,
  dumbbell: Dumbbell,
};

export function iconForActivity(name: string): IconComponent {
  return ACTIVITY_ICONS[name] ?? Send;
}
