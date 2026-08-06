"use client";

import { useParams } from "next/navigation";
import { TaskDetail } from "@/components/projects/task-detail";

export default function TaskPage() {
  const params = useParams<{ id: string }>();
  return <TaskDetail taskId={params.id} />;
}
