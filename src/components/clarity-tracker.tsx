"use client";

import { useEffect } from "react";
import Clarity from "@microsoft/clarity";

let initializedProjectId: string | undefined;

export function ClarityTracker({ projectId }: { projectId?: string }) {
  useEffect(() => {
    const id = projectId?.trim();
    if (!id || !/^[a-zA-Z0-9]+$/.test(id) || initializedProjectId === id) return;

    Clarity.init(id);
    initializedProjectId = id;
  }, [projectId]);

  return null;
}
