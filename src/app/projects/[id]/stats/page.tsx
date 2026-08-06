"use client";

import { useParams } from "next/navigation";
import { ProjectAnalytics } from "@/components/projects/project-analytics";

export default function ProjectStatsPage() {
  const params = useParams<{ id: string }>();
  return <ProjectAnalytics projectId={params.id} />;
}
