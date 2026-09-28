import { describe, expect, it } from "vitest";
import { GAP_X, layoutTree, LEVEL_HEIGHT, NODE_HEIGHT, NODE_WIDTH, type TreeInput } from "./atom-tree";

const leaf = (id: string): TreeInput => ({ id, children: [] });
const STEP = NODE_WIDTH + GAP_X;

describe("rozmístění stromu atomů", () => {
  it("samotný uzel stojí vlevo nahoře", () => {
    const out = layoutTree(leaf("a"));

    expect(out.nodes).toEqual([{ id: "a", depth: 0, x: 0, y: 0 }]);
    expect(out.edges).toEqual([]);
    expect(out.width).toBe(NODE_WIDTH);
    expect(out.height).toBe(NODE_HEIGHT);
  });

  it("rodič sedí přesně nad svými dětmi", () => {
    const out = layoutTree({ id: "r", children: [leaf("a"), leaf("b")] });
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;

    expect(at("a").x).toBe(0);
    expect(at("b").x).toBe(STEP);
    // Střed mezi oběma listy.
    expect(at("r").x).toBe(STEP / 2);
    expect(at("r").y).toBe(0);
    expect(at("a").y).toBe(LEVEL_HEIGHT);
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
    expect(out.width).toBe(3 * STEP - GAP_X);
    expect(out.height).toBe(2 * LEVEL_HEIGHT + NODE_HEIGHT);
  });

  it("střed uzlu sedí doprostřed jeho obdélníku", () => {
    const out = layoutTree(leaf("a"));

    expect(out.center(out.nodes[0])).toEqual({ x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 });
  });
});
