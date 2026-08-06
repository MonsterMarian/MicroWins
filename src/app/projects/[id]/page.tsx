"use client";

import { useParams } from "next/navigation";
import { ProjectDetail } from "@/components/projects/project-detail";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  return <ProjectDetail projectId={params.id} />;
}
