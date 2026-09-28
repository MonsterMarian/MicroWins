/**
 * Rozmístění stromu atomů do plátna.
 *
 * Klasická kreslená struktura: kořen nahoře, pod ním patra jeho kusů, listy
 * dole. Vodorovně se počítá po **listech** - každý list dostane svůj sloupec
 * a rodič se posadí doprostřed nad svoje děti. Díky tomu se hrany nikde
 * nekříží a strom se čte shora dolů jako na papíře.
 *
 * Čistá funkce nad obecným tvarem stromu, takže neví nic o úkolech ani
 * o Reactu - viz `atom-tree.test.ts`.
 */

/** Rozměry uzlu a rozestupy v pixelech; plátno se pak škáluje jako celek. */
export const NODE_WIDTH = 136;
export const NODE_HEIGHT = 64;
export const GAP_X = 16;
export const LEVEL_HEIGHT = 104;

export interface TreeInput {
  id: string;
  children: TreeInput[];
}

export interface PlacedNode {
  id: string;
  depth: number;
  /** Levý horní roh uzlu v plátně. */
  x: number;
  y: number;
}

export interface TreeEdge {
  from: string;
  to: string;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
  /** Střed uzlu - kreslení hran a posun plátna na vybraný uzel. */
  center: (node: PlacedNode) => { x: number; y: number };
}

const STEP = NODE_WIDTH + GAP_X;

export function layoutTree(root: TreeInput): TreeLayout {
  const nodes: PlacedNode[] = [];
  const edges: TreeEdge[] = [];
  let nextLeaf = 0;
  let maxDepth = 0;

  /** Vrací sloupec uzlu: list bere další volný, rodič střed svých dětí. */
  const walk = (node: TreeInput, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    let column: number;

    if (node.children.length === 0) {
      column = nextLeaf;
      nextLeaf += 1;
    } else {
      const spots = node.children.map((child) => {
        edges.push({ from: node.id, to: child.id });
        return walk(child, depth + 1);
      });
      column = (spots[0] + spots[spots.length - 1]) / 2;
    }

    nodes.push({ id: node.id, depth, x: column * STEP, y: depth * LEVEL_HEIGHT });
    return column;
  };

  walk(root, 0);

  return {
    nodes,
    edges,
    width: Math.max(1, nextLeaf) * STEP - GAP_X,
    height: maxDepth * LEVEL_HEIGHT + NODE_HEIGHT,
    center: (node) => ({ x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 }),
  };
}

/**
 * Hrana mezi rodičem a dítětem. Svislá esíčka místo lomených čar: v hustém
 * stromu se dvě čáry vedle sebe dají rozeznat, dvě lomené se slijí.
 */
export function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const start = from.y + NODE_HEIGHT / 2;
  const end = to.y - NODE_HEIGHT / 2;
  const mid = start + (end - start) / 2;
  return `M${from.x},${start} C${from.x},${mid} ${to.x},${mid} ${to.x},${end}`;
}
