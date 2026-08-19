const fs = require('fs');
const file = 'src/components/ui/sortable.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Update DragState
content = content.replace(
  'interface DragState {',
  'interface DragState {\n  hoverId?: string | null;'
);

// 2. Update Session
content = content.replace(
  '  detach: () => void;\n}',
  '  detach: () => void;\n  hoverId?: string | null;\n}'
);

// 3. Update SortableList props
content = content.replace(
  '  ids: string[];\n  onReorder: (ids: string[]) => void;\n  disabled?: boolean;',
  '  ids: string[];\n  onReorder: (ids: string[]) => void;\n  onDropInto?: (id: string, targetId: string) => void;\n  isFolder?: (id: string) => boolean;\n  disabled?: boolean;'
);

content = content.replace(
  '  ids,\n  onReorder,\n  disabled = false,',
  '  ids,\n  onReorder,\n  onDropInto,\n  isFolder,\n  disabled = false,'
);

content = content.replace(
  '  const latest = React.useRef({ ids, onReorder, axis });\n  latest.current = { ids, onReorder, axis };',
  '  const latest = React.useRef({ ids, onReorder, onDropInto, isFolder, axis });\n  latest.current = { ids, onReorder, onDropInto, isFolder, axis };'
);

// 4. Update the update() function
content = content.replace(
  '    let to = s.index;\n    s.rows.forEach((other, i) => {\n      if (i === s.index) return;\n      const otherCenter = other.start + other.size / 2;\n      if (i < s.index && center < otherCenter) to = Math.min(to, i);\n      if (i > s.index && center > otherCenter) to = Math.max(to, i);\n    });\n\n    if (to !== s.to) void tapFeedback();\n    s.to = to;\n    setDrag((prev) => (prev && prev.delta === delta && prev.to === to ? prev : prev && { ...prev, delta, to }));',
  `    let to = s.index;
    let hoverId: string | null = null;
    s.rows.forEach((other, i) => {
      if (i === s.index) return;
      const otherCenter = other.start + other.size / 2;
      
      if (latest.current.isFolder && latest.current.isFolder(latest.current.ids[i])) {
        const distance = Math.abs(center - otherCenter);
        if (distance < other.size * 0.3) {
          hoverId = latest.current.ids[i];
        }
      }
      
      if (i < s.index && center < otherCenter) to = Math.min(to, i);
      if (i > s.index && center > otherCenter) to = Math.max(to, i);
    });

    if (hoverId) {
      to = s.index;
    }

    if (to !== s.to || hoverId !== s.hoverId) void tapFeedback();
    s.to = to;
    s.hoverId = hoverId;
    setDrag((prev) => (prev && prev.delta === delta && prev.to === to && prev.hoverId === hoverId ? prev : prev && { ...prev, delta, to, hoverId }));`
);

// 5. Update onEnd in press
content = content.replace(
  '        const wasDragging = s.dragging;\n        const { index, to } = s;\n        cancel();\n        if (!wasDragging || to === index) return;\n\n        const next = [...latest.current.ids];\n        const [moved] = next.splice(index, 1);\n        next.splice(to, 0, moved);\n        latest.current.onReorder(next);',
  `        const wasDragging = s.dragging;
        const { index, to, hoverId, id } = s;
        cancel();
        if (!wasDragging) return;

        if (hoverId && latest.current.onDropInto) {
          latest.current.onDropInto(id, hoverId);
          return;
        }

        if (to === index) return;
        const next = [...latest.current.ids];
        const [moved] = next.splice(index, 1);
        next.splice(to, 0, moved);
        latest.current.onReorder(next);`
);

// 6. Add hover style to SortableItem
content = content.replace(
  '  const waiting = pressed === id;',
  '  const waiting = pressed === id;\n  const hoverTarget = drag?.hoverId === id;'
);

content = content.replace(
  '        drag && !active && "z-0",',
  '        drag && !active && "z-0",\n        hoverTarget && "ring-2 ring-primary ring-inset bg-primary/10",'
);

fs.writeFileSync(file, content);
console.log("Replaced successfully!");
