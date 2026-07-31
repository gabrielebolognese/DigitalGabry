import { useState } from "react";
import AppShell from "./components/AppShell";
import type { ViewId } from "./components/Rail";

export default function App() {
  const [view, setView] = useState<ViewId>("calendar");

  return <AppShell view={view} onViewChange={setView} />;
}
