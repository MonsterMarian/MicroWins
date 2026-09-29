/**
 * Rozmístění stromu atomů do plátna.
 *
 * Klasická kreslená struktura: kořen nahoře, pod ním patra jeho kusů, listy
 * dole. Vodorovně se počítá po **listech** - každý list dostane svůj sloupec
 * a rodič se posadí doprostřed nad svoje děti. Díky tomu se hrany nikde
 * nekříží a strom se čte shora dolů jako na papíře.
 *
 * Buňky nemají stejnou výšku (popis je volitelný a různě dlouhý), takže patro
 * je vysoké jako jeho nejvyšší buňka. Na tohle automatické místo se pak
 * přičte ruční posun (`offset`): ten se počítá **od rodiče**, takže
 * odtažený rodič si veze celý svůj podstrom a ručně srovnané děti se mu
 * nerozsypou.
 *
 * Čistá funkce nad obecným tvarem stromu, takže neví nic o úkolech ani
 * o Reactu - viz `atom-tree.test.ts`.
 */

/** Šířka buňky a rozestupy v pixelech plátna; zoom se dělá až nad tím. */
export const NODE_WIDTH = 184;
/** Odhad výšky, než se buňka stihne změřit. */
export const NODE_MIN_HEIGHT = 48;
export const GAP_X = 20;
export const GAP_Y = 44;

export interface TreeInput {
  id: string;
  children: TreeInput[];
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode {
  id: string;
  parentId: string | null;
  depth: number;
  /** Levý horní roh buňky v plátně - už i s ručním posunem. */
  x: number;
  y: number;
  height: number;
}

export interface TreeEdge {
  from: string;
  to: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TreeLayout {
  /** Rodič vždycky před svými dětmi. */
  nodes: PlacedNode[];
  edges: TreeEdge[];
  bounds: Bounds;
}

export interface LayoutOptions {
  /** Změřená výška buňky; neznámá = `NODE_MIN_HEIGHT`. */
  heightOf?: (id: string) => number | undefined;
  /** Ruční posun buňky proti místu, kam ji postaví strom (relativně k rodiči). */
  offsetOf?: (id: string) => Point | undefined;
}

const STEP = NODE_WIDTH + GAP_X;

export function layoutTree(root: TreeInput, options: LayoutOptions = {}): TreeLayout {
  const heightOf = (id: string) => Math.max(NODE_MIN_HEIGHT, options.heightOf?.(id) ?? 0);

  // 1. Sloupce: list bere další volný, rodič střed svých dětí.
  const column = new Map<string, number>();
  const depthOf = new Map<string, number>();
  const levelHeight: number[] = [];
  let nextLeaf = 0;

  const walk = (node: TreeInput, depth: number): number => {
    depthOf.set(node.id, depth);
    levelHeight[depth] = Math.max(levelHeight[depth] ?? 0, heightOf(node.id));
    let col: number;
    if (node.children.length === 0) {
      col = nextLeaf;
      nextLeaf += 1;
    } else {
      const spots = node.children.map((child) => walk(child, depth + 1));
      col = (spots[0] + spots[spots.length - 1]) / 2;
    }
    column.set(node.id, col);
    return col;
  };
  walk(root, 0);

  // 2. Patra pod sebou - každé tak vysoké jako jeho nejvyšší buňka.
  const levelTop: number[] = [];
  let top = 0;
  for (let depth = 0; depth < levelHeight.length; depth += 1) {
    levelTop[depth] = top;
    top += levelHeight[depth] + GAP_Y;
  }

  // 3. Ruční posuny shora dolů: dítě se posune o to, o co se posunul rodič.
  const nodes: PlacedNode[] = [];
  const edges: TreeEdge[] = [];
  const place = (node: TreeInput, parentId: string | null, carried: Point) => {
    const depth = depthOf.get(node.id) ?? 0;
    const own = options.offsetOf?.(node.id);
    const shift = { x: carried.x + (own?.x ?? 0), y: carried.y + (own?.y ?? 0) };
    nodes.push({
      id: node.id,
      parentId,
      depth,
      x: (column.get(node.id) ?? 0) * STEP + shift.x,
      y: levelTop[depth] + shift.y,
      height: heightOf(node.id),
    });
    for (const child of node.children) {
      edges.push({ from: node.id, to: child.id });
      place(child, node.id, shift);
    }
  };
  place(root, null, { x: 0, y: 0 });

  return { nodes, edges, bounds: boundsOf(nodes) };
}

export function boundsOf(nodes: PlacedNode[]): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_MIN_HEIGHT };
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + NODE_WIDTH)),
    maxY: Math.max(...nodes.map((n) => n.y + n.height)),
  };
}

/**
 * Hrana od spodku rodiče ke hlavě dítěte. Svislá esíčka místo lomených čar:
 * v hustém stromu se dvě čáry vedle sebe dají rozeznat, dvě lomené se slijí.
 * Když je dítě odtažené nad rodiče, esíčko se jen obrátí - pořád je vidět,
 * co s čím souvisí.
 */
export function edgePath(parent: PlacedNode, child: PlacedNode): string {
  const from = { x: parent.x + NODE_WIDTH / 2, y: parent.y + parent.height };
  const to = { x: child.x + NODE_WIDTH / 2, y: child.y };
  const bend = Math.max(24, Math.abs(to.y - from.y) / 2);
  return `M${from.x},${from.y} C${from.x},${from.y + bend} ${to.x},${to.y - bend} ${to.x},${to.y}`;
}

// --- kamera -----------------------------------------------------------------

/** Pohled na plátno: posun obrazovky a zvětšení. Bod plátna `p` je na `p * zoom + (x, y)`. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Kamera, ve které je celý strom vidět a stojí uprostřed okna. Víc než 100 % nezvětšuje. */
export function fitCamera(bounds: Bounds, width: number, height: number, padding = 24): Camera {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const zoom = clampZoom(
    Math.min(1, (width - padding * 2) / Math.max(1, w), (height - padding * 2) / Math.max(1, h)),
  );
  return {
    zoom,
    x: (width - w * zoom) / 2 - bounds.minX * zoom,
    // Vysoký strom začíná nahoře (kořen je to hlavní), nízký se vycentruje.
    y: Math.max(padding, (height - h * zoom) / 2) - bounds.minY * zoom,
  };
}

/**
 * Zvětšení kolem pevného bodu obrazovky - pod prsty (nebo kurzorem) má zůstat
 * pořád totéž místo plátna, jinak zoom "ujíždí" do rohu.
 */
export function zoomAround(camera: Camera, zoom: number, anchor: Point): Camera {
  const next = clampZoom(zoom);
  const k = next / camera.zoom;
  return {
    zoom: next,
    x: anchor.x - (anchor.x - camera.x) * k,
    y: anchor.y - (anchor.y - camera.y) * k,
  };
}
