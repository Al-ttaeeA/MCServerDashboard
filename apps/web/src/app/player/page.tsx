"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PlayerProfile } from "@/components/player/PlayerProfile";

/**
 * Player profile: /player/?name=<name>.
 *
 * A query parameter (rather than /players/[name]) because the site is a
 * static export: dynamic route segments must be known at build time, but
 * new players appear between deploys.
 */
function PlayerPage() {
  const name = useSearchParams().get("name") ?? "";
  return <PlayerProfile key={name} name={name} />;
}

export default function Page() {
  return (
    <Suspense>
      <PlayerPage />
    </Suspense>
  );
}
