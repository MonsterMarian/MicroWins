const fs = require('fs');

// 1. Update sortable.tsx
let sortable = fs.readFileSync('src/components/ui/sortable.tsx', 'utf8');

sortable = sortable.replace(
  'transition: active ? "none" : "transform 0.16s ease"',
  'transition: active ? "none" : "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)"'
);

sortable = sortable.replace(
  '"relative bg-card transition-[box-shadow,transform]",',
  '"relative bg-card transition-all duration-200",'
);

sortable = sortable.replace(
  'active && "z-20 scale-[1.02] rounded-lg shadow-lg ring-1 ring-border",',
  'active && "z-50 scale-[1.03] rotate-[2deg] rounded-lg shadow-xl ring-2 ring-primary/40 bg-background",'
);

sortable = sortable.replace(
  'hoverTarget && "ring-2 ring-primary ring-inset bg-primary/10",',
  'hoverTarget && "scale-[1.015] ring-2 ring-primary ring-inset bg-primary/15 shadow-md",'
);

fs.writeFileSync('src/components/ui/sortable.tsx', sortable);

// 2. Update tree-view.tsx
let tree = fs.readFileSync('src/components/tree/tree-view.tsx', 'utf8');

// Add onSettings to WinRow calls
tree = tree.replace(
  '                  <WinRow\n                    node={node}\n                    open={expanded.has(node.id)}\n                    onToggle={toggle}\n                    onAddEntry={setEntryFor}\n                    onNodeRequest={setNodeRequest}\n                    onDelete={setPendingDelete}\n                  />',
  '                  <WinRow\n                    node={node}\n                    open={expanded.has(node.id)}\n                    onToggle={toggle}\n                    onAddEntry={setEntryFor}\n                    onNodeRequest={setNodeRequest}\n                    onDelete={setPendingDelete}\n                    onSettings={setSettingsFor}\n                  />'
);

// Add onSettings prop to WinRow definition
tree = tree.replace(
  '  onAddEntry: (metric: TreeNode) => void;\n  onNodeRequest: (req: NodeDialogState) => void;\n  onDelete: (node: TreeNode) => void;\n}) {',
  '  onAddEntry: (metric: TreeNode) => void;\n  onNodeRequest: (req: NodeDialogState) => void;\n  onDelete: (node: TreeNode) => void;\n  onSettings: (node: TreeNode) => void;\n}) {'
);

// Add Settings button to WinRow
tree = tree.replace(
  '        <div className="flex shrink-0 items-center gap-0.5">\n          <IconAction\n            label="Upravit"',
  `        <div className="flex shrink-0 items-center gap-0.5">\n          <IconAction label="Nastaven\u00ED (p\u0159esun)" onClick={() => onSettings(node)}>\n            <Settings2 />\n          </IconAction>\n          <IconAction\n            label="Upravit"`
);

// Update FolderSettingsDialog text to be more generic
tree = tree.replace(
  'description="P\u0159esun bere cel\u00FD obsah slo\u017Eky v\u010Detn\u011B podslo\u017Eek."',
  'description={node.kind === "category" ? "P\u0159esun bere cel\u00FD obsah slo\u017Eky v\u010Detn\u011B podslo\u017Eek." : "P\u0159esun objektu do jin\u00E9 slo\u017Eky."}'
);

tree = tree.replace(
  '            Jin\u00E1 slo\u017Eka, kam by \u0161la p\u0159esunout, zat\u00EDm nen\u00ED - vlastn\u00ED podslo\u017Eky to logicky\n            nemohou b\u00FDt.',
  '            Jin\u00E1 slo\u017Eka, kam by \u0161la p\u0159esunout, zat\u00EDm nen\u00ED.'
);

fs.writeFileSync('src/components/tree/tree-view.tsx', tree);

console.log("Improved DND animations and added Move dialog to WinRow");
