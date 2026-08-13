"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useStore } from "@/components/providers/store-provider";
import { Overview } from "./overviews";
import { ProjectDialog } from "./project-dialog";
import { ProjectRow } from "./project-row";
import { TodoPanel } from "./todo-panel";
import { countTodos } from "@/lib/todos";
import {
  filterProjects,
  sortProjects,
  PROJECT_FILTER_LABEL,
  PROJECT_SORT_LABEL,
  type ProjectFilter,
  type ProjectSort,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

/*
 * Tři záložky. „Úkoly" a „Dnes" ukazovaly stejná data potřetí a počtvrté
 * - úkoly jsou v projektu, dnešek v přehledu - a zmizely.
 *
 * ToDo je mezi Přehledem a Projekty schválně: je to obyčejný seznam na dnešek,
 * ne třetí pohled na projekty. Kdo si chce jen odškrtnout, co má koupit, nemá
 * kvůli tomu zakládat projekt s procenty a deadlinem.
 */
type Tab = "overview" | "todo" | "projects";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Přehled" },
  { id: "todo", label: "ToDo" },
  { id: "projects", label: "Projekty" },
];

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.id === value);
}

export function ProjectsHub() {
  const { state } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  /*
   * Záložka žije v adrese, ne ve stavu komponenty. Jinak by se návrat z detailu
   * projektu vždycky vrátil na Přehled - historie prohlížeče o rozkliknuté
   * záložce nic neví. `replace` proto, aby přepínání záložek nezahltilo
   * historii a tlačítko Zpět vedlo rovnou z rozdělané práce ven.
   */
  const setTab = (next: Tab) => router.replace(`/?tab=${next}`, { scroll: false });

  /*
   * Bez `?tab=` v adrese (studený start appky, klik na logo, spodní lišta)
   * rozhoduje seznam: je-li co odškrtnout, otevře se ToDo, jinak Přehled.
   *
   * Spočítá se **jednou při otevření** a dál se drží. Kdyby se to přepočítávalo
   * při každém renderu, odškrtnutí poslední položky by uživateli pod rukama
   * přehodilo záložku na Přehled - přesně ve chvíli, kdy si chce prohlédnout,
   * co dodělal.
   */
  const [openedOn] = React.useState<Tab>(() =>
    countTodos(state.todos).open > 0 ? "todo" : "overview",
  );
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : openedOn;

  /* Prázdná výzva k založení projektu platí jen tam, kde jsou projekty vidět.
     Na ToDo by zakryla seznam, se kterým projekty nemají nic společného. */
  const noProjects = state.projects.length === 0 && tab !== "todo";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {tab === "todo" ? "ToDo" : "Projekty"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tab === "todo"
              ? "Krátký seznam na dnešek. Odškrtnuté zmizí samo."
              : "Velké cíle rozsekané na měřitelné úkoly a denní postup."}
          </p>
        </div>
        {/* Na ToDo tlačítko nepatří: nová položka se píše rovnou do řádku
            nad seznamem a druhá cesta k témuž by jen pletla. */}
        {tab === "todo" ? null : (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> Nový projekt
          </Button>
        )}
      </header>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {noProjects ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">Zatím žádný projekt</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Projekt drží procenta, deadline a úkoly. Postup se zaznamenává den po dni, takže
              vznikne graf i deník změn. Na jednorázové věci je vedle ToDo.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus /> Nový projekt
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTab("todo")}>
                Otevřít ToDo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : tab === "todo" ? (
        <TodoPanel />
      ) : tab === "overview" ? (
        <Overview onNewProject={() => setDialogOpen(true)} />
      ) : (
        <ProjectsTab onNewProject={() => setDialogOpen(true)} />
      )}

      <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

// --- projekty ---------------------------------------------------------------

function ProjectsTab({ onNewProject }: { onNewProject: () => void }) {
  const { state, today, reorderProjects } = useStore();
  const [filter, setFilter] = React.useState<ProjectFilter>("all");
  const [sort, setSort] = React.useState<ProjectSort>("custom");
  const [query, setQuery] = React.useState("");

  const rows = React.useMemo(() => {
    const filtered = filterProjects(state, filter, today).filter((p) =>
      p.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return sortProjects(state, filtered, sort);
  }, [state, filter, sort, query, today]);

  /* Přetahovat jde jen ve vlastním pořadí - v ostatních řazeních by se
     puštěný řádek okamžitě vrátil tam, kam ho posílá abeceda nebo procenta. */
  const draggable = sort === "custom";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ProjectFilter)}
          aria-label="Filtr projektů"
          className="w-auto"
        >
          {Object.entries(PROJECT_FILTER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          aria-label="Řazení projektů"
          className="w-auto"
        >
          {Object.entries(PROJECT_SORT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat projekt"
            className="pl-8"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nic neodpovídá filtru.</p>
            <Button size="sm" variant="outline" onClick={onNewProject}>
              <Plus /> Nový projekt
            </Button>
          </div>
        ) : (
          <SortableList
            ids={rows.map((p) => p.id)}
            onReorder={reorderProjects}
            disabled={!draggable}
            className="divide-y"
          >
            {rows.map((project) => (
              <SortableItem key={project.id} id={project.id}>
                <ProjectRow project={project} />
              </SortableItem>
            ))}
          </SortableList>
        )}
      </Card>

      {rows.length > 1 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {draggable
            ? "Podrž prst na projektu a přetáhni ho. Pořadí se uloží samo."
            : "Přetahovat jde ve vlastním pořadí - přepni řazení vlevo nahoře."}
        </p>
      ) : null}
    </div>
  );
}
