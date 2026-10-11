"use client";

import { Flag, MapPin } from "lucide-react";
import type { EntityRef } from "@/lib/model/types";
import { useApp } from "@/components/state/app-state";
import { IconButton } from "@/components/ui/primitives";

export function CardActions({ refTo, children }: { refTo: EntityRef; children?: React.ReactNode }) {
  const { state, dispatch } = useApp();
  const isMet = refTo.type === "metabolite";
  const isFrom = state.routeFrom?.metaboliteId === refTo.id;
  const isTo = state.routeTo?.metaboliteId === refTo.id;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
      {children}
      <div className="ml-auto flex items-center gap-0.5">
        {isMet && (
          <>
            <IconButton
              label="Маршрут отсюда"
              active={isFrom}
              onClick={() =>
                dispatch({ type: "setRouteEndpoint", end: "from", value: { metaboliteId: refTo.id, anyCompartment: false }, openPanel: true })
              }
            >
              <MapPin className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Маршрут сюда"
              active={isTo}
              onClick={() =>
                dispatch({ type: "setRouteEndpoint", end: "to", value: { metaboliteId: refTo.id, anyCompartment: false }, openPanel: true })
              }
            >
              <Flag className="h-4 w-4" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
