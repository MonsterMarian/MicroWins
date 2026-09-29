import { describe, expect, it } from "vitest";
import {
  fitCamera,
  GAP_X,
  GAP_Y,
  layoutTree,
  MAX_ZOOM,
  NODE_MIN_HEIGHT,
  NODE_WIDTH,
  zoomAround,
  type TreeInput,
} from "./atom-tree";

const leaf = (id: string): TreeInput => ({ id, children: [] });
const STEP = NODE_WIDTH + GAP_X;

describe("rozmístění stromu atomů", () => {
  it("samotný uzel stojí vlevo nahoře", () => {
    const out = layoutTree(leaf("a"));

    expect(out.nodes).toEqual([
      { id: "a", parentId: null, depth: 0, x: 0, y: 0, height: NODE_MIN_HEIGHT },
    ]);
    expect(out.edges).toEqual([]);
    expect(out.bounds).toEqual({ minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_MIN_HEIGHT });
  });

  it("rodič sedí přesně nad svými dětmi", () => {
    const out = layoutTree({ id: "r", children: [leaf("a"), leaf("b")] });
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;

    expect(at("a").x).toBe(0);
    expect(at("b").x).toBe(STEP);
    // Střed mezi oběma listy.
    expect(at("r").x).toBe(STEP / 2);
    expect(at("r").y).toBe(0);
    expect(at("a").y).toBe(NODE_MIN_HEIGHT + GAP_Y);
    expect(out.edges).toEqual([
      { from: "r", to: "a" },
      { from: "r", to: "b" },
    ]);
  });

  it("hlubší větev si listy nerozhází - každý má svůj sloupec", () => {
    const out = layoutTree({
      id: "r",
      children: [{ id: "a", children: [leaf("a1"), leaf("a2")] }, leaf("b")],
    });
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;

    expect([at("a1").x, at("a2").x, at("b").x]).toEqual([0, STEP, 2 * STEP]);
    expect(at("a").x).toBe(STEP / 2);
    expect(at("r").x).toBe((at("a").x + at("b").x) / 2);
    expect(at("a1").depth).toBe(2);
    expect(out.bounds.maxX).toBe(3 * STEP - GAP_X);
  });

  it("patro je vysoké jako jeho nejvyšší buňka", () => {
    const heights: Record<string, number> = { r: 100, a: 60, b: 140 };
    const out = layoutTree(
      { id: "r", children: [leaf("a"), leaf("b")] },
      { heightOf: (id) => heights[id] },
    );
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;

    expect(at("a").y).toBe(100 + GAP_Y);
    expect(at("b").y).toBe(100 + GAP_Y);
    expect(out.bounds.maxY).toBe(100 + GAP_Y + 140);
  });

  it("posunutý rodič veze podstrom, posun dítěte se k tomu přičte", () => {
    const tree = { id: "r", children: [{ id: "a", children: [leaf("a1")] }, leaf("b")] };
    const auto = layoutTree(tree);
    const moved = layoutTree(tree, {
      offsetOf: (id) => (id === "a" ? { x: 50, y: 30 } : id === "a1" ? { x: -10, y: 0 } : undefined),
    });
    const before = (id: string) => auto.nodes.find((n) => n.id === id)!;
    const after = (id: string) => moved.nodes.find((n) => n.id === id)!;

    expect(after("a").x - before("a").x).toBe(50);
    expect(after("a").y - before("a").y).toBe(30);
    expect(after("a1").x - before("a1").x).toBe(40);
    expect(after("a1").y - before("a1").y).toBe(30);
    // Sourozenec a kořen zůstanou, kde byly.
    expect(after("b")).toEqual(before("b"));
    expect(after("r")).toEqual(before("r"));
  });
});

describe("kamera", () => {
  it("malý strom se nezvětší přes 100 % a stojí uprostřed", () => {
    const cam = fitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 400, 300);

    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(150);
    expect(cam.y).toBe(125);
  });

  it("zoom kolem bodu nechá ten bod na místě", () => {
    const cam = { x: 10, y: 20, zoom: 1 };
    const anchor = { x: 200, y: 100 };
    const canvasPoint = { x: (anchor.x - cam.x) / cam.zoom, y: (anchor.y - cam.y) / cam.zoom };
    const next = zoomAround(cam, 2, anchor);

    expect(canvasPoint.x * next.zoom + next.x).toBeCloseTo(anchor.x);
    expect(canvasPoint.y * next.zoom + next.y).toBeCloseTo(anchor.y);
  });

  it("zoom se drží v mezích", () => {
    expect(zoomAround({ x: 0, y: 0, zoom: 1 }, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
});
