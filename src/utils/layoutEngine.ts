import type { TreeNode, TreeEdge } from '../db/indexedDB';

export interface PositionedNode extends TreeNode {
  x: number;
  y: number;
}

export function computeLayout(
  nodes: TreeNode[],
  edges: TreeEdge[],
  canvasWidth: number = 1200,
  verticalGap: number = 220,
  nodeHorizontalGap: number = 100,
  coupleHorizontalGap: number = 240
): PositionedNode[] {
  if (nodes.length === 0) return [];

  // 1. Calculate generation depth (level) for each node.
  // Default level is 0
  const levels: Record<string, number> = {};
  nodes.forEach((n) => {
    levels[n.id] = 0;
  });

  // Parent-child relationships determine vertical flow.
  // Parent level is always less than child level.
  const parentChildEdges = edges.filter(
    (e) =>
      e.type === 'BIOLOGICAL_PARENT' ||
      e.type === 'ADOPTIVE_PARENT' ||
      e.type === 'FOSTER_PARENT' ||
      e.type === 'STEP_PARENT'
  );

  // Relax levels iteratively (bellman-ford style, max depth 20 to prevent cycles)
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    parentChildEdges.forEach((edge) => {
      const parentLvl = levels[edge.source];
      const childLvl = levels[edge.target];
      if (childLvl <= parentLvl) {
        levels[edge.target] = parentLvl + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }

  // 2. Identify spouse/partner relationships in the same generation.
  // Partner edges are non-parent-child links like SPOUSE, DIVORCED, CONSANGUINOUS, FIANCE, SEPARATED
  const partnerEdges = edges.filter(
    (e) =>
      e.type === 'SPOUSE' ||
      e.type === 'DIVORCED' ||
      e.type === 'CONSANGUINOUS' ||
      e.type === 'FIANCE' ||
      e.type === 'SEPARATED' ||
      e.type === 'EX_PARTNER'
  );

  // Group nodes by level
  const nodesByLevel: Record<number, TreeNode[]> = {};
  nodes.forEach((node) => {
    const lvl = levels[node.id] || 0;
    if (!nodesByLevel[lvl]) {
      nodesByLevel[lvl] = [];
    }
    nodesByLevel[lvl].push(node);
  });

  const positionedNodes: PositionedNode[] = [];

  // 3. For each generation level, place couples side-by-side, then center
  const levelKeys = Object.keys(nodesByLevel)
    .map(Number)
    .sort((a, b) => a - b);

  levelKeys.forEach((lvl) => {
    const lvlNodes = nodesByLevel[lvl];
    const visited = new Set<string>();
    const groupedGroups: Array<TreeNode[]> = [];

    // Group spouses side-by-side
    lvlNodes.forEach((node) => {
      if (visited.has(node.id)) return;

      // Find if this node has a spouse in the same level
      const partnerEdge = partnerEdges.find(
        (e) =>
          (e.source === node.id && lvlNodes.some((n) => n.id === e.target && !visited.has(n.id))) ||
          (e.target === node.id && lvlNodes.some((n) => n.id === e.source && !visited.has(n.id)))
      );

      if (partnerEdge) {
        const partnerId = partnerEdge.source === node.id ? partnerEdge.target : partnerEdge.source;
        const partnerNode = lvlNodes.find((n) => n.id === partnerId)!;
        
        visited.add(node.id);
        visited.add(partnerNode.id);
        
        // Put female or unknown/intersex on the right, male on the left, for conventional display
        if (node.sex === 'M' && partnerNode.sex === 'F') {
          groupedGroups.push([node, partnerNode]);
        } else {
          groupedGroups.push([partnerNode, node]);
        }
      } else {
        visited.add(node.id);
        groupedGroups.push([node]);
      }
    });

    // Compute total width of this level to center it
    let totalLevelWidth = 0;
    groupedGroups.forEach((group, idx) => {
      if (group.length === 2) {
        totalLevelWidth += nodeHorizontalGap; // distance between couple
      }
      if (idx < groupedGroups.length - 1) {
        totalLevelWidth += coupleHorizontalGap; // gap between groups
      }
    });

    const startX = (canvasWidth - totalLevelWidth) / 2;
    let currentX = startX;
    const yPos = 80 + lvl * verticalGap;

    groupedGroups.forEach((group) => {
      if (group.length === 1) {
        const node = group[0];
        // If node has manually saved coordinate offsets/positions in DB, preserve them!
        const finalX = node.x !== undefined ? node.x : currentX;
        const finalY = node.y !== undefined ? node.y : yPos;

        positionedNodes.push({
          ...node,
          x: finalX,
          y: finalY,
        });
        currentX += coupleHorizontalGap;
      } else if (group.length === 2) {
        const nodeA = group[0];
        const nodeB = group[1];

        const xA = nodeA.x !== undefined ? nodeA.x : currentX;
        const xB = nodeB.x !== undefined ? nodeB.x : currentX + nodeHorizontalGap;

        // Force spouses to share the same Y position to avoid vertical misalignment.
        let yComm = yPos;
        if (nodeA.y !== undefined && nodeB.y !== undefined) {
          yComm = (nodeA.y + nodeB.y) / 2;
        } else if (nodeA.y !== undefined) {
          yComm = nodeA.y;
        } else if (nodeB.y !== undefined) {
          yComm = nodeB.y;
        }

        positionedNodes.push({
          ...nodeA,
          x: xA,
          y: yComm,
        });

        positionedNodes.push({
          ...nodeB,
          x: xB,
          y: yComm,
        });

        currentX += nodeHorizontalGap + coupleHorizontalGap;
      }
    });
  });

  return positionedNodes;
}
