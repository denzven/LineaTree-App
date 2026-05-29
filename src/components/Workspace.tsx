import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../db/indexedDB';
import type { TreeNode, TreeEdge, ImageAsset } from '../db/indexedDB';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeLayout } from '../utils/layoutEngine';
import type { PositionedNode } from '../utils/layoutEngine';
import { exportTreeToSvgString, triggerDownload, triggerPrintWindow } from '../utils/exportPdf';
import type { ExportTheme, ExportLayout } from '../utils/exportPdf';
import {
  SearchIcon, ZoomInIcon, ZoomOutIcon, ResetIcon, ExportIcon, PrintIcon, LinkIcon,
  CloseIcon, UserIcon, Trash2Icon, MenuIcon
} from './Icons';

interface WorkspaceProps {
  readOnly: boolean;
  initialTemplateNodes?: TreeNode[];
  initialTemplateEdges?: TreeEdge[];
  onBackToHome: () => void;
  isInstallable: boolean;
  onInstallPWA: () => void;
}

export const Workspace: React.FC<WorkspaceProps> = ({
  readOnly,
  initialTemplateNodes,
  initialTemplateEdges,
  onBackToHome,
  isInstallable,
  onInstallPWA
}) => {
  // 1. Fetch live query data from IndexedDB
  const liveNodes = useLiveQuery(() => db.nodes.toArray()) || [];
  const liveEdges = useLiveQuery(() => db.edges.toArray()) || [];
  const liveImages = useLiveQuery(() => db.images.toArray()) || [];

  // Working state (if in readOnly preview mode, we use template states instead)
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [edges, setEdges] = useState<TreeEdge[]>([]);

  useEffect(() => {
    if (readOnly && initialTemplateNodes && initialTemplateEdges) {
      setNodes(initialTemplateNodes);
      setEdges(initialTemplateEdges);
    } else {
      setNodes(liveNodes);
      setEdges(liveEdges);
    }
  }, [liveNodes, liveEdges, readOnly, initialTemplateNodes, initialTemplateEdges]);


  // 2. Interactive Canvas states
  const [panX, setPanX] = useState(60);
  const [panY, setPanY] = useState(100);
  const [zoom, setZoom] = useState(0.85);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Bind native non-passive touchmove and wheel event listeners to fully block native browser zooming
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Prevent default browser pinch zooming on the entire viewport
        e.preventDefault();
      }
    };

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Prevent default trackpad pinch page zooming
        e.preventDefault();
      }
    };

    canvas.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      canvas.removeEventListener('touchmove', handleNativeTouchMove);
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  // 3. Selection & Search States
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [customModal, setCustomModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM';
    onConfirm?: () => void;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Active Undo/Redo History Stack & Clipboard Refs
  const historyStack = useRef<{ nodes: TreeNode[]; edges: TreeEdge[] }[]>([]);
  const historyPointer = useRef<number>(-1);
  const hasInitializedHistory = useRef(false);
  const copiedNodes = useRef<TreeNode[]>([]);
  const copiedEdges = useRef<TreeEdge[]>([]);

  const recordHistory = (nodesState: TreeNode[], edgesState: TreeEdge[]) => {
    const currentStack = historyStack.current.slice(0, historyPointer.current + 1);
    const newSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodesState)),
      edges: JSON.parse(JSON.stringify(edgesState))
    };
    historyStack.current = [...currentStack, newSnapshot];
    historyPointer.current = historyStack.current.length - 1;
  };

  // Initialize history snapshot once query loads
  useEffect(() => {
    if (liveNodes.length > 0 && !hasInitializedHistory.current) {
      recordHistory(liveNodes, liveEdges);
      hasInitializedHistory.current = true;
    }
  }, [liveNodes, liveEdges]);

  const handleUndo = async () => {
    if (historyPointer.current <= 0) {
      setCustomModal({
        isOpen: true,
        title: 'Undo Boundary',
        message: 'No further actions to undo in this session.',
        type: 'ALERT'
      });
      triggerHapticFeedback('ERROR');
      return;
    }

    historyPointer.current--;
    const previousState = historyStack.current[historyPointer.current];
    if (previousState) {
      await db.transaction('rw', [db.nodes, db.edges], async () => {
        await db.nodes.clear();
        await db.edges.clear();
        await db.nodes.bulkAdd(previousState.nodes);
        await db.edges.bulkAdd(previousState.edges);
      });
      setNodes(previousState.nodes);
      setEdges(previousState.edges);
      triggerHapticFeedback('TICK');
    }
  };

  const handleRedo = async () => {
    if (historyPointer.current >= historyStack.current.length - 1) {
      setCustomModal({
        isOpen: true,
        title: 'Redo Boundary',
        message: 'No further actions to redo.',
        type: 'ALERT'
      });
      triggerHapticFeedback('ERROR');
      return;
    }

    historyPointer.current++;
    const nextState = historyStack.current[historyPointer.current];
    if (nextState) {
      await db.transaction('rw', [db.nodes, db.edges], async () => {
        await db.nodes.clear();
        await db.edges.clear();
        await db.nodes.bulkAdd(nextState.nodes);
        await db.edges.bulkAdd(nextState.edges);
      });
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      triggerHapticFeedback('TICK');
    }
  };

  const handleCopy = () => {
    if (selectedNodeIds.length === 0) return;
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    copiedNodes.current = selectedNodes;

    const internalEdges = edges.filter(
      (e) => selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target)
    );
    copiedEdges.current = internalEdges;

    setCustomModal({
      isOpen: true,
      title: 'Items Copied',
      message: `Copied ${selectedNodes.length} individual(s) and ${internalEdges.length} relationship line(s) to custom LineaTree clipboard.`,
      type: 'ALERT'
    });
  };

  const handlePaste = async () => {
    if (copiedNodes.current.length === 0) return;

    const idMapping: Record<string, string> = {};
    const newNodesToInsert: TreeNode[] = [];
    const newEdgesToInsert: TreeEdge[] = [];

    copiedNodes.current.forEach((n) => {
      const newId = `n_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      idMapping[n.id] = newId;

      const dupNode: TreeNode = {
        ...n,
        id: newId,
        name: n.name.includes('(Copy)') ? n.name : `${n.name} (Copy)`,
        x: (n.x || 0) + 80,
        y: (n.y || 0) + 80
      };
      newNodesToInsert.push(dupNode);
    });

    copiedEdges.current.forEach((e) => {
      const newSource = idMapping[e.source];
      const newTarget = idMapping[e.target];
      if (newSource && newTarget) {
        const newId = `e_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const dupEdge: TreeEdge = {
          ...e,
          id: newId,
          source: newSource,
          target: newTarget
        };
        newEdgesToInsert.push(dupEdge);
      }
    });

    await db.transaction('rw', [db.nodes, db.edges], async () => {
      await db.nodes.bulkAdd(newNodesToInsert);
      await db.edges.bulkAdd(newEdgesToInsert);
    });

    const pastedIds = newNodesToInsert.map((n) => n.id);
    setSelectedNodeIds(pastedIds);
    setSelectedNodeId(pastedIds[pastedIds.length - 1]);

    const updatedNodes = [...nodes, ...newNodesToInsert];
    const updatedEdges = [...edges, ...newEdgesToInsert];
    recordHistory(updatedNodes, updatedEdges);

    setCustomModal({
      isOpen: true,
      title: 'Items Pasted',
      message: `Pasted ${newNodesToInsert.length} individual(s) and ${newEdgesToInsert.length} relationship line(s) with custom alignment offset.`,
      type: 'ALERT'
    });
  };
  const [generationClamp, setGenerationClamp] = useState(4);

  // 4. Layer Visibility Checklists
  const [visibleLayers, setVisibleLayers] = useState({
    FRIEND: true,
    COWORKER: true,
    CLASSMATE: true,
    NEIGHBOR: true
  });

  // 5. PDF & SVG Print Customization Drawer
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [exportTheme, setExportTheme] = useState<ExportTheme>('ONE_DARK');
  const [exportLayout, setExportLayout] = useState<ExportLayout>('SINGLE_PAGE_BLUEPRINT');

  // 6. Action Mode overlays (e.g. spouse add, parent add, social link add)
  const [relationMode, setRelationMode] = useState<{
    sourceId: string;
    actionType: 'SPOUSE' | 'PARENT' | 'SOCIAL';
  } | null>(null);
  const [socialTargetId, setSocialTargetId] = useState('');
  const [socialType, setSocialType] = useState<TreeEdge['type']>('FRIEND');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isInspectorActionsOpen, setIsInspectorActionsOpen] = useState(false);
  const [isTopBarActionsOpen, setIsTopBarActionsOpen] = useState(false);

  // Right-Click Custom Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX?: number;
    canvasY?: number;
    nodeId?: string;
  } | null>(null);

  // Auto-close context menu on any standard click
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  useEffect(() => {
    setIsInspectorActionsOpen(false);
    setIsTopBarActionsOpen(false);
  }, [selectedNodeId]);

  // 7. Compute Generation Levels and Node Positions
  const positionedNodes: PositionedNode[] = computeLayout(nodes, edges, 1200, 240, 110, 260);

  // Filtered nodes based on Generation Clamp
  const nodeLevels = useRef<Record<string, number>>({});
  // Calculate level depths for active nodes to enforce generation clamps
  useEffect(() => {
    const lvls: Record<string, number> = {};
    nodes.forEach((n) => { lvls[n.id] = 0; });
    const pEdges = edges.filter(
      (e) => e.type === 'BIOLOGICAL_PARENT' || e.type === 'ADOPTIVE_PARENT' || e.type === 'FOSTER_PARENT'
    );
    for (let i = 0; i < 6; i++) {
      pEdges.forEach((e) => {
        const parentLvl = lvls[e.source] || 0;
        const childLvl = lvls[e.target] || 0;
        if (childLvl <= parentLvl) {
          lvls[e.target] = parentLvl + 1;
        }
      });
    }
    nodeLevels.current = lvls;
  }, [nodes, edges]);

  const maxLevel = Math.max(0, ...Object.values(nodeLevels.current), 0);

  const isVisibleNode = (nodeId: string) => {
    const lvl = nodeLevels.current[nodeId] || 0;
    return lvl <= generationClamp;
  };

  // Keyboard shortcut interception for sandboxed PWA constraints (Active Undo, Redo, Copy, Paste)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement).tagName.toLowerCase();
      if (targetTag === 'input' || targetTag === 'select' || targetTag === 'textarea') {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // Undo (Ctrl+Z)
      if (isCtrlOrMeta && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }

      // Redo (Ctrl+Y or Ctrl+Shift+Z)
      if ((isCtrlOrMeta && e.key.toLowerCase() === 'y') || (isCtrlOrMeta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        handleRedo();
      }

      // Save (Ctrl+S) -> Download offline .ltree archive
      if (isCtrlOrMeta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleExportLtreeArchive();
        setCustomModal({
          isOpen: true,
          title: 'Pedigree Archived',
          message: 'Your LineaTree family pedigree has been compiled into a secure client-side .ltree archive. The file has been successfully downloaded.',
          type: 'ALERT'
        });
      }

      // Copy (Ctrl+C)
      if (isCtrlOrMeta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      }

      // Paste (Ctrl+V)
      if (isCtrlOrMeta && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nodes, edges, selectedNodeIds]);

  // 8. Autocomplete search results
  const filteredSearchNodes = searchQuery.trim()
    ? nodes.filter((n) => n.name.toLowerCase().includes(searchQuery.toLowerCase()) || (n.chosenName && n.chosenName.toLowerCase().includes(searchQuery.toLowerCase())))
    : [];

  const handleSearchSelect = (nodeId: string) => {
    const node = positionedNodes.find((n) => n.id === nodeId);
    if (node) {
      // Center canvas on node
      setPanX(window.innerWidth / 2 - node.x * zoom);
      setPanY(window.innerHeight / 2 - node.y * zoom);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
    }
    setSearchQuery('');
    setShowSearchResults(false);
  };

  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.ctrlKey || e.shiftKey) {
      setSelectedNodeIds((prev) => {
        const isAlreadySelected = prev.includes(nodeId);
        if (isAlreadySelected) {
          const filtered = prev.filter((id) => id !== nodeId);
          setSelectedNodeId(filtered.length > 0 ? filtered[filtered.length - 1] : null);
          return filtered;
        } else {
          setSelectedNodeId(nodeId);
          return [...prev, nodeId];
        }
      });
    } else {
      setSelectedNodeIds([nodeId]);
      setSelectedNodeId(nodeId);
    }
  };

  // 9. Node dragging implementation
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const activeDragIds = useRef<string[]>([]);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const dragStartPositions = useRef<Record<string, { x: number; y: number }>>({});

  // Mobile touch-first UX refs
  const longPressTimer = useRef<any>(null);
  const longPressActive = useRef<boolean>(false);
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const drawerTouchStart = useRef<number | null>(null);

  // Mobile Haptic Vibration Feedback Helper (Tactile PWA UX)
  const triggerHapticFeedback = (type: 'TICK' | 'SUCCESS' | 'WARNING' | 'ERROR') => {
    if (!navigator.vibrate) return;
    try {
      switch (type) {
        case 'TICK':
          navigator.vibrate(12);
          break;
        case 'SUCCESS':
          navigator.vibrate([15, 30, 15]);
          break;
        case 'WARNING':
          navigator.vibrate([35, 50, 35]);
          break;
        case 'ERROR':
          navigator.vibrate([60, 40, 60, 40, 60]);
          break;
      }
    } catch (e) {
      console.warn('Vibration blocked');
    }
  };

  // Camera Support & Mobile Permission States
  const [cameraModalNodeId, setCameraModalNodeId] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startCamera = async (facingMode: 'user' | 'environment') => {
    setCameraError(null);
    if (cameraStream.current) {
      cameraStream.current.getTracks().forEach((track) => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 640 }
        },
        audio: false
      });
      cameraStream.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.error('Camera access failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Permission Denied: Please grant camera access in your system/browser settings to take a photo.');
      } else {
        setCameraError(`Camera Error: ${err.message || 'No camera device found or access blocked.'}`);
      }
      triggerHapticFeedback('ERROR');
    }
  };

  const handleOpenCameraModal = (nodeId: string) => {
    setCameraModalNodeId(nodeId);
    setCameraError(null);
    setCameraFacingMode('user');
    triggerHapticFeedback('TICK');
    // Start camera stream (using a short timeout to ensure DOM mount of videoRef)
    setTimeout(() => {
      startCamera('user');
    }, 100);
  };

  const handleCloseCameraModal = () => {
    if (cameraStream.current) {
      cameraStream.current.getTracks().forEach((track) => track.stop());
      cameraStream.current = null;
    }
    setCameraModalNodeId(null);
    setCameraError(null);
    triggerHapticFeedback('TICK');
  };

  const handleToggleCameraFacing = () => {
    const nextMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    setCameraFacingMode(nextMode);
    startCamera(nextMode);
    triggerHapticFeedback('TICK');
  };

  const handleCapturePhoto = async () => {
    if (!videoRef.current || !cameraModalNodeId) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const size = Math.min(video.videoWidth, video.videoHeight) || 480;
    canvas.width = 400;
    canvas.height = 400;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const sx = (video.videoWidth - size) / 2 || 0;
      const sy = (video.videoHeight - size) / 2 || 0;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, 400, 400);
      
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const imageAssetId = `img_${Date.now()}`;
      
      await db.images.put({ id: imageAssetId, blobData: compressedDataUrl });
      await handleUpdateNodeField(cameraModalNodeId, 'imageBlobId', imageAssetId);
      
      triggerHapticFeedback('SUCCESS');
    }

    handleCloseCameraModal();
  };

  const handleNodeDragStart = (e: React.MouseEvent, nodeId: string) => {
    if (readOnly) return;
    e.stopPropagation();
    setDraggedNodeId(nodeId);
    triggerHapticFeedback('TICK');

    // If node is not selected, select it
    if (!selectedNodeIds.includes(nodeId)) {
      if (e.ctrlKey || e.shiftKey) {
        setSelectedNodeIds((prev) => [...prev, nodeId]);
      } else {
        setSelectedNodeIds([nodeId]);
        setSelectedNodeId(nodeId);
      }
    }

    // Identify spousal/horizontally related nodes to move them rigidly together!
    const initialTargets = selectedNodeIds.includes(nodeId) 
      ? (selectedNodeIds.includes(nodeId) ? selectedNodeIds : [...selectedNodeIds, nodeId]) 
      : [nodeId];
    
    const visited = new Set<string>(initialTargets);
    const queue = [...initialTargets];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      edges.forEach((edge) => {
        const isSpousal = ['SPOUSE', 'FIANCE', 'DIVORCED', 'SEPARATED', 'CONSANGUINOUS', 'EX_PARTNER'].includes(edge.type);
        if (isSpousal) {
          if (edge.source === curr && !visited.has(edge.target)) {
            visited.add(edge.target);
            queue.push(edge.target);
          } else if (edge.target === curr && !visited.has(edge.source)) {
            visited.add(edge.source);
            queue.push(edge.source);
          }
        }
      });
    }
    
    const allRigidTargets = Array.from(visited);
    activeDragIds.current = allRigidTargets;

    // Capture starting positions of all selected/rigid nodes
    const initialPositions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => {
      initialPositions[n.id] = { x: n.x || 0, y: n.y || 0 };
    });
    dragStartPositions.current = initialPositions;

    const pageX = e.clientX;
    const pageY = e.clientY;
    dragStartOffset.current = {
      x: pageX,
      y: pageY
    };
  };

  const handleNodeTouchStart = (e: React.TouchEvent, nodeId: string) => {
    if (readOnly) return;
    e.stopPropagation();

    const touch = e.touches[0];
    triggerHapticFeedback('TICK');
    const startX = touch.clientX;
    const startY = touch.clientY;
    touchStartPos.current = { x: startX, y: startY };
    longPressActive.current = false;

    // Start 600ms long press timer for mobile right click custom context menu!
    longPressTimer.current = setTimeout(() => {
      longPressActive.current = true;
      setContextMenu({
        x: startX,
        y: startY,
        nodeId
      });
    }, 600);

    setDraggedNodeId(nodeId);

    if (!selectedNodeIds.includes(nodeId)) {
      setSelectedNodeIds([nodeId]);
      setSelectedNodeId(nodeId);
    }

    const initialPositions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => {
      initialPositions[n.id] = { x: n.x || 0, y: n.y || 0 };
    });
    dragStartPositions.current = initialPositions;

    const initialTargets = selectedNodeIds.includes(nodeId) 
      ? (selectedNodeIds.includes(nodeId) ? selectedNodeIds : [...selectedNodeIds, nodeId]) 
      : [nodeId];
    
    const visited = new Set<string>(initialTargets);
    const queue = [...initialTargets];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      edges.forEach((edge) => {
        const isSpousal = ['SPOUSE', 'FIANCE', 'DIVORCED', 'SEPARATED', 'CONSANGUINOUS', 'EX_PARTNER'].includes(edge.type);
        if (isSpousal) {
          if (edge.source === curr && !visited.has(edge.target)) {
            visited.add(edge.target);
            queue.push(edge.target);
          } else if (edge.target === curr && !visited.has(edge.source)) {
            visited.add(edge.source);
            queue.push(edge.source);
          }
        }
      });
    }
    activeDragIds.current = Array.from(visited);

    dragStartOffset.current = {
      x: startX,
      y: startY
    };
  };

  const handleNodeDragMove = (e: React.MouseEvent) => {
    if (!draggedNodeId || readOnly) return;
    const pageX = e.clientX;
    const pageY = e.clientY;
    
    // Divide screen cursor movements by zoom factor so coordinates move 1:1 with mouse cursor!
    const deltaX = (pageX - dragStartOffset.current.x) / zoom;
    const deltaY = (pageY - dragStartOffset.current.y) / zoom;

    const targets = activeDragIds.current;
    const isSingleDrag = selectedNodeIds.length <= 1;

    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === draggedNodeId) {
          const startPos = dragStartPositions.current[n.id] || { x: n.x || 0, y: n.y || 0 };
          return {
            ...n,
            x: startPos.x + deltaX,
            y: startPos.y + deltaY
          };
        } else if (targets.includes(n.id)) {
          const startPos = dragStartPositions.current[n.id] || { x: n.x || 0, y: n.y || 0 };
          if (isSingleDrag) {
            // Spouses follow vertically (Y) but remain stationary horizontally (X) so user can adjust separation!
            return {
              ...n,
              y: startPos.y + deltaY
            };
          } else {
            // Rigid multi-selection translation
            return {
              ...n,
              x: startPos.x + deltaX,
              y: startPos.y + deltaY
            };
          }
        }
        return n;
      })
    );
  };

  const handleNodeDragEnd = async () => {
    if (!draggedNodeId || readOnly) return;
    const targets = activeDragIds.current;

    let hasChanged = false;
    await db.transaction('rw', [db.nodes], async () => {
      for (const tId of targets) {
        const finalNode = nodes.find((n) => n.id === tId);
        if (finalNode && finalNode.x !== undefined && finalNode.y !== undefined) {
          await db.nodes.update(tId, {
            x: finalNode.x,
            y: finalNode.y
          });
          hasChanged = true;
        }
      }
    });

    if (hasChanged) {
      recordHistory(nodes, edges);
      triggerHapticFeedback('TICK');
    }
    setDraggedNodeId(null);
    activeDragIds.current = [];
  };

  // 10. Canvas Pan Gesture Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if clicking canvas background or read-only
    if (draggedNodeId) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - panX, y: e.clientY - panY };

    // Clear selection if clicking on the background grid itself
    if (e.target === e.currentTarget || (e.target as SVGElement).tagName === 'svg') {
      setSelectedNodeIds([]);
      setSelectedNodeId(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (draggedNodeId) {
      handleNodeDragMove(e);
      return;
    }
    if (!isPanning) return;
    setPanX(e.clientX - panStart.current.x);
    setPanY(e.clientY - panStart.current.y);
  };

  const handleCanvasMouseUp = () => {
    if (draggedNodeId) {
      handleNodeDragEnd();
      return;
    }
    setIsPanning(false);
  };

  // 10b. Mouse Wheel and Trackpad Pinch-to-Zoom Handler
  const handleCanvasWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    const wrapper = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - wrapper.left;
    const mouseY = e.clientY - wrapper.top;

    const graphX = (mouseX - panX) / zoom;
    const graphY = (mouseY - panY) / zoom;

    // Trackpad pinch-to-zoom gestures are scaled smoothly.
    const factor = e.ctrlKey ? 0.015 : 0.0015;
    const delta = -e.deltaY * factor;

    setZoom((prevZoom) => {
      const newZoom = Math.min(2.5, Math.max(0.15, prevZoom + delta));
      
      // Shift pan offsets to anchor zoom exactly to the cursor tip!
      setPanX(mouseX - graphX * newZoom);
      setPanY(mouseY - graphY * newZoom);
      
      return newZoom;
    });
  };

  // Touch gesture state refs for responsive pinch-to-zoom on tablets and mobile touch viewports
  const touchStartDist = useRef<number | null>(null);
  const touchStartZoom = useRef<number>(0.85);
  const touchStartCenter = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartPan = useRef<{ x: number; y: number }>({ x: 60, y: 100 });

  const handleCanvasTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Capture finger distance for zoom ratio
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchStartDist.current = dist;
      touchStartZoom.current = zoom;
      
      // Capture midpoint between two pinch points for anchor zoom
      const wrapper = e.currentTarget.getBoundingClientRect();
      const centerX = ((t1.clientX + t2.clientX) / 2) - wrapper.left;
      const centerY = ((t1.clientY + t2.clientY) / 2) - wrapper.top;
      touchStartCenter.current = { x: centerX, y: centerY };
      touchStartPan.current = { x: panX, y: panY };
    } else if (e.touches.length === 1 && !draggedNodeId) {
      // Single-finger canvas pan panning
      setIsPanning(true);
      const touch = e.touches[0];
      panStart.current = { x: touch.clientX - panX, y: touch.clientY - panY };
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist.current !== null) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      
      const ratio = currentDist / touchStartDist.current;
      const newZoom = Math.min(2.5, Math.max(0.15, touchStartZoom.current * ratio));

      const centerX = touchStartCenter.current.x;
      const centerY = touchStartCenter.current.y;
      
      const graphX = (centerX - touchStartPan.current.x) / touchStartZoom.current;
      const graphY = (centerY - touchStartPan.current.y) / touchStartZoom.current;

      setZoom(newZoom);
      setPanX(centerX - graphX * newZoom);
      setPanY(centerY - graphY * newZoom);
    } else if (e.touches.length === 1 && isPanning && !draggedNodeId) {
      const touch = e.touches[0];
      setPanX(touch.clientX - panStart.current.x);
      setPanY(touch.clientY - panStart.current.y);
    } else if (e.touches.length === 1 && draggedNodeId) {
      // Node touch dragging!
      const touch = e.touches[0];
      
      // Jitter threshold checking to clear long press menu timer if user drags!
      const dist = Math.hypot(touch.clientX - touchStartPos.current.x, touch.clientY - touchStartPos.current.y);
      if (dist > 8) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      if (longPressActive.current) return;

      const deltaX = (touch.clientX - dragStartOffset.current.x) / zoom;
      const deltaY = (touch.clientY - dragStartOffset.current.y) / zoom;

      const targets = activeDragIds.current;
      const isSingleDrag = selectedNodeIds.length <= 1;

      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === draggedNodeId) {
            const startPos = dragStartPositions.current[n.id] || { x: n.x || 0, y: n.y || 0 };
            return {
              ...n,
              x: startPos.x + deltaX,
              y: startPos.y + deltaY
            };
          } else if (targets.includes(n.id)) {
            const startPos = dragStartPositions.current[n.id] || { x: n.x || 0, y: n.y || 0 };
            if (isSingleDrag) {
              // Spouses follow vertically (Y) but remain stationary horizontally (X) so user can adjust separation!
              return {
                ...n,
                y: startPos.y + deltaY
              };
            } else {
              // Rigid multi-selection translation
              return {
                ...n,
                x: startPos.x + deltaX,
                y: startPos.y + deltaY
              };
            }
          }
          return n;
        })
      );
    }
  };

  const handleCanvasTouchEnd = (e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (draggedNodeId) {
      if (!longPressActive.current) {
        handleNodeDragEnd();
      } else {
        setDraggedNodeId(null);
      }
    }

    if (e.touches.length < 2) {
      touchStartDist.current = null;
    }
    if (e.touches.length === 0) {
      setIsPanning(false);
    }
  };

  // 11. Scale view mode mapping triggers
  const getLoDMode = () => {
    if (zoom < 0.35) return 'SYMBOLIC';
    if (zoom <= 0.75) return 'NAMES';
    return 'FULL';
  };

  const handleSetViewMode = (mode: 'SYMBOLIC' | 'NAMES' | 'FULL') => {
    if (mode === 'SYMBOLIC') setZoom(0.28);
    else if (mode === 'NAMES') setZoom(0.55);
    else setZoom(1.0);
  };

  // 12. CRUD Actions - Add Spouses, Parents, Social Nodes
  const handleQuickAddSpouse = async (sourceId: string) => {
    if (readOnly) return;
    const newId = `n_${Date.now()}`;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    const newSpouse: TreeNode = {
      id: newId,
      type: 'INDIVIDUAL',
      name: 'New Spouse',
      sex: sourceNode.sex === 'M' ? 'F' : 'M',
      lifeStatus: 'ALIVE',
      traits: [],
      x: (sourceNode.x || 0) + 120,
      y: sourceNode.y || 100
    };

    const newEdge: TreeEdge = {
      id: `e_${Date.now()}`,
      source: sourceId,
      target: newId,
      type: 'SPOUSE'
    };

    await db.transaction('rw', [db.nodes, db.edges], async () => {
      await db.nodes.add(newSpouse);
      await db.edges.add(newEdge);
    });

    setSelectedNodeId(newId);
    setSelectedNodeIds([newId]);
    setRelationMode(null);
    recordHistory([...nodes, newSpouse], [...edges, newEdge]);
  };

  const handleQuickAddParent = async (sourceId: string) => {
    if (readOnly) return;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    const pFId = `n_pf_${Date.now()}`;
    const pMId = `n_pm_${Date.now()}`;
    const currentY = sourceNode.y || 300;
    const currentX = sourceNode.x || 600;

    const father: TreeNode = {
      id: pFId,
      type: 'INDIVIDUAL',
      name: 'New Father',
      sex: 'M',
      lifeStatus: 'ALIVE',
      traits: [],
      x: currentX - 100,
      y: currentY - 240
    };

    const mother: TreeNode = {
      id: pMId,
      type: 'INDIVIDUAL',
      name: 'New Mother',
      sex: 'F',
      lifeStatus: 'ALIVE',
      traits: [],
      x: currentX + 100,
      y: currentY - 240
    };

    const edgeF: TreeEdge = {
      id: `e_p1_${Date.now()}`,
      source: pFId,
      target: sourceId,
      type: 'BIOLOGICAL_PARENT'
    };

    const edgeM: TreeEdge = {
      id: `e_p2_${Date.now()}`,
      source: pMId,
      target: sourceId,
      type: 'BIOLOGICAL_PARENT'
    };

    const edgeMarriage: TreeEdge = {
      id: `e_pmar_${Date.now()}`,
      source: pFId,
      target: pMId,
      type: 'SPOUSE'
    };

    await db.transaction('rw', [db.nodes, db.edges], async () => {
      await db.nodes.bulkAdd([father, mother]);
      await db.edges.bulkAdd([edgeF, edgeM, edgeMarriage]);
    });

    setSelectedNodeId(pFId);
    setSelectedNodeIds([pFId]);
    setRelationMode(null);
    recordHistory([...nodes, father, mother], [...edges, edgeF, edgeM, edgeMarriage]);
  };

  const handleQuickAddChild = async (sourceId: string) => {
    if (readOnly) return;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    const newId = `n_child_${Date.now()}`;
    const newChild: TreeNode = {
      id: newId,
      type: 'INDIVIDUAL',
      name: 'New Child',
      sex: 'UNKNOWN',
      lifeStatus: 'ALIVE',
      traits: [],
      x: (sourceNode.x || 0) + (Math.random() - 0.5) * 40,
      y: (sourceNode.y || 0) + 240
    };

    const edge1: TreeEdge = {
      id: `e_child1_${Date.now()}`,
      source: sourceId,
      target: newId,
      type: 'BIOLOGICAL_PARENT'
    };

    // Auto-detect spouse to link them as the second biological parent!
    const spouseEdge = edges.find(
      (e) =>
        (e.type === 'SPOUSE' || e.type === 'CONSANGUINOUS') &&
        (e.source === sourceId || e.target === sourceId)
    );
    const spouseId = spouseEdge
      ? spouseEdge.source === sourceId
        ? spouseEdge.target
        : spouseEdge.source
      : null;

    const edgesToAdd = [edge1];
    if (spouseId) {
      edgesToAdd.push({
        id: `e_child2_${Date.now()}`,
        source: spouseId,
        target: newId,
        type: 'BIOLOGICAL_PARENT'
      });
    }

    await db.transaction('rw', [db.nodes, db.edges], async () => {
      await db.nodes.add(newChild);
      await db.edges.bulkAdd(edgesToAdd);
    });

    setSelectedNodeId(newId);
    setSelectedNodeIds([newId]);
    recordHistory([...nodes, newChild], [...edges, ...edgesToAdd]);
  };

  const handleQuickAddSibling = async (sourceId: string) => {
    if (readOnly) return;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    // Find parents of the sourceNode (biological, adoptive, or foster)
    const parentEdges = edges.filter(
      (e) =>
        (e.type === 'BIOLOGICAL_PARENT' ||
          e.type === 'ADOPTIVE_PARENT' ||
          e.type === 'FOSTER_PARENT') &&
        e.target === sourceId
    );

    const newId = `n_sib_${Date.now()}`;
    const newSibling: TreeNode = {
      id: newId,
      type: 'INDIVIDUAL',
      name: 'New Sibling',
      sex: 'UNKNOWN',
      lifeStatus: 'ALIVE',
      traits: [],
      x: (sourceNode.x || 0) + 180,
      y: sourceNode.y || 300
    };

    const edgesToAdd: TreeEdge[] = [];

    if (parentEdges.length > 0) {
      // Sibling shares the exact same parents!
      parentEdges.forEach((pEdge, idx) => {
        edgesToAdd.push({
          id: `e_sib_p${idx}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          source: pEdge.source,
          target: newId,
          type: pEdge.type
        });
      });

      await db.transaction('rw', [db.nodes, db.edges], async () => {
        await db.nodes.add(newSibling);
        await db.edges.bulkAdd(edgesToAdd);
      });

      setSelectedNodeId(newId);
      setSelectedNodeIds([newId]);
      recordHistory([...nodes, newSibling], [...edges, ...edgesToAdd]);
    } else {
      // SourceNode has no parents: create a biological father and mother, a spousal edge, and link both
      const pFId = `n_pf_${Date.now()}`;
      const pMId = `n_pm_${Date.now()}`;
      const currentY = sourceNode.y || 300;
      const currentX = sourceNode.x || 600;

      const father: TreeNode = {
        id: pFId,
        type: 'INDIVIDUAL',
        name: 'New Father',
        sex: 'M',
        lifeStatus: 'ALIVE',
        traits: [],
        x: currentX - 100,
        y: currentY - 240
      };

      const mother: TreeNode = {
        id: pMId,
        type: 'INDIVIDUAL',
        name: 'New Mother',
        sex: 'F',
        lifeStatus: 'ALIVE',
        traits: [],
        x: currentX + 100,
        y: currentY - 240
      };

      // Connect father and mother with SPOUSE
      const edgeMarriage: TreeEdge = {
        id: `e_pmar_${Date.now()}`,
        source: pFId,
        target: pMId,
        type: 'SPOUSE'
      };

      // Connect both parents to sourceNode
      const edgeF1: TreeEdge = {
        id: `e_p1_${Date.now()}`,
        source: pFId,
        target: sourceId,
        type: 'BIOLOGICAL_PARENT'
      };
      const edgeM1: TreeEdge = {
        id: `e_p2_${Date.now()}`,
        source: pMId,
        target: sourceId,
        type: 'BIOLOGICAL_PARENT'
      };

      // Connect both parents to the new sibling
      const edgeF2: TreeEdge = {
        id: `e_p1_sib_${Date.now()}`,
        source: pFId,
        target: newId,
        type: 'BIOLOGICAL_PARENT'
      };
      const edgeM2: TreeEdge = {
        id: `e_p2_sib_${Date.now()}`,
        source: pMId,
        target: newId,
        type: 'BIOLOGICAL_PARENT'
      };

      await db.transaction('rw', [db.nodes, db.edges], async () => {
        await db.nodes.bulkAdd([father, mother, newSibling]);
        await db.edges.bulkAdd([edgeMarriage, edgeF1, edgeM1, edgeF2, edgeM2]);
      });

      setSelectedNodeId(newId);
      setSelectedNodeIds([newId]);
      recordHistory(
        [...nodes, father, mother, newSibling],
        [...edges, edgeMarriage, edgeF1, edgeM1, edgeF2, edgeM2]
      );
    }
  };

  const handleAddIndependentNode = async (x: number, y: number) => {
    if (readOnly) return;
    const newId = `n_ind_${Date.now()}`;
    const newNode: TreeNode = {
      id: newId,
      type: 'INDIVIDUAL',
      name: 'New Individual',
      sex: 'UNKNOWN',
      lifeStatus: 'ALIVE',
      traits: [],
      x: Math.round(x),
      y: Math.round(y)
    };

    await db.nodes.add(newNode);
    setSelectedNodeId(newId);
    setSelectedNodeIds([newId]);
    recordHistory([...nodes, newNode], edges);
  };

  const handleDeleteSelectedNodes = async () => {
    if (readOnly || selectedNodeIds.length === 0) return;
    triggerHapticFeedback('WARNING');
    setCustomModal({
      isOpen: true,
      title: 'Delete Selected Node(s)',
      message: `Are you sure you want to delete ${selectedNodeIds.length} selected individual(s) and all their relationships? This action is permanent.`,
      type: 'CONFIRM',
      onConfirm: async () => {
        const remainingNodes = nodes.filter((n) => !selectedNodeIds.includes(n.id));
        const remainingEdges = edges.filter(
          (e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
        );

        await db.transaction('rw', [db.nodes, db.edges], async () => {
          for (const id of selectedNodeIds) {
            await db.nodes.delete(id);
            const connectedEdges = edges.filter((e) => e.source === id || e.target === id);
            for (const e of connectedEdges) {
              await db.edges.delete(e.id);
            }
          }
        });

        setSelectedNodeIds([]);
        setSelectedNodeId(null);
        setCustomModal(null);
        recordHistory(remainingNodes, remainingEdges);
        triggerHapticFeedback('SUCCESS');
      }
    });
  };

  const handleAddSocialEdge = async () => {
    if (readOnly || !relationMode || !socialTargetId) return;
    
    const newEdge: TreeEdge = {
      id: `e_soc_${Date.now()}`,
      source: relationMode.sourceId,
      target: socialTargetId,
      type: socialType
    };

    await db.edges.add(newEdge);
    setRelationMode(null);
    setSocialTargetId('');
    recordHistory(nodes, [...edges, newEdge]);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (readOnly) return;
    triggerHapticFeedback('WARNING');
    setCustomModal({
      isOpen: true,
      title: 'Delete Individual',
      message: 'Are you sure you want to delete this individual and all their relationship lines? This action is permanent.',
      type: 'CONFIRM',
      onConfirm: async () => {
        const remainingNodes = nodes.filter((n) => n.id !== nodeId);
        const remainingEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

        await db.transaction('rw', [db.nodes, db.edges], async () => {
          await db.nodes.delete(nodeId);
          const connectedEdges = edges.filter((e) => e.source === nodeId || e.target === nodeId);
          for (const e of connectedEdges) {
            await db.edges.delete(e.id);
          }
        });
        setSelectedNodeIds((prev) => prev.filter((id) => id !== nodeId));
        setSelectedNodeId(null);
        setCustomModal(null);
        recordHistory(remainingNodes, remainingEdges);
        triggerHapticFeedback('SUCCESS');
      }
    });
  };

  // 13. Inspector Form Changes
  const handleUpdateNodeField = async (nodeId: string, field: keyof TreeNode, value: any) => {
    if (readOnly) return;
    const updatedNodes = nodes.map((n) => (n.id === nodeId ? { ...n, [field]: value } : n));
    setNodes(updatedNodes);
    await db.nodes.update(nodeId, { [field]: value });
    recordHistory(updatedNodes, edges);
  };

  const handleAddTrait = async (nodeId: string, trait: string) => {
    if (!trait.trim()) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const updatedTraits = [...node.traits, trait.trim()];
    await handleUpdateNodeField(nodeId, 'traits', updatedTraits);
  };

  const handleRemoveTrait = async (nodeId: string, idxToRemove: number) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const updatedTraits = node.traits.filter((_, idx) => idx !== idxToRemove);
    await handleUpdateNodeField(nodeId, 'traits', updatedTraits);
  };

  // Client side compression and downsampling (Phase 2, Item 2)
  const handleCompressAndUploadImage = (e: React.ChangeEvent<HTMLInputElement>, nodeId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const maxDim = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85); // downsample client side
          
          const imageAssetId = `img_${Date.now()}`;
          // Write downsampled image asset base64 to Images Table
          await db.images.put({ id: imageAssetId, blobData: compressedDataUrl });
          // Link node to imageAssetId
          await handleUpdateNodeField(nodeId, 'imageBlobId', imageAssetId);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // 14. Export Archive and Print Options
  const handleExportLtreeArchive = () => {
    const data = {
      nodes: liveNodes,
      edges: liveEdges,
      images: liveImages
    };
    const jsonString = JSON.stringify(data, null, 2);
    triggerDownload(jsonString, 'familytree_archive.ltree', 'application/json');
  };

  const handlePrintToVector = () => {
    // Collect active visible nodes inside generation clamp
    const activeNodes = positionedNodes.filter((n) => isVisibleNode(n.id));
    const activeEdges = edges.filter(
      (e) => isVisibleNode(e.source) && isVisibleNode(e.target)
    );

    const svgString = exportTreeToSvgString(activeNodes, activeEdges, exportTheme, exportLayout);
    triggerPrintWindow(svgString, exportTheme);
    setShowPrintOptions(false);
  };

  const getSelectedRelationship = () => {
    if (selectedNodeIds.length !== 2) return null;
    const [idA, idB] = selectedNodeIds;
    const nodeA = nodes.find(n => n.id === idA);
    const nodeB = nodes.find(n => n.id === idB);
    if (!nodeA || !nodeB) return null;

    // 1. Direct Edge Check
    const directEdge = edges.find(
      (e) => (e.source === idA && e.target === idB) || (e.source === idB && e.target === idA)
    );

    if (directEdge) {
      const type = directEdge.type;
      const isSourceA = directEdge.source === idA;
      
      switch (type) {
        case 'SPOUSE':
          return 'Spouses (Married)';
        case 'CONSANGUINOUS':
          return 'Consanguinous Spouses (Related by blood)';
        case 'DIVORCED':
          return 'Divorced';
        case 'FIANCE':
          return 'Fiancés / Engaged';
        case 'SEPARATED':
          return 'Separated';
        case 'EX_PARTNER':
          return 'Ex-Partners';
        case 'BIOLOGICAL_PARENT':
          return isSourceA 
            ? `${nodeA.name} is the Biological Parent of ${nodeB.name}`
            : `${nodeB.name} is the Biological Parent of ${nodeA.name}`;
        case 'ADOPTIVE_PARENT':
          return isSourceA
            ? `${nodeA.name} is the Adoptive Parent of ${nodeB.name}`
            : `${nodeB.name} is the Adoptive Parent of ${nodeA.name}`;
        case 'FOSTER_PARENT':
          return isSourceA
            ? `${nodeA.name} is the Foster Parent of ${nodeB.name}`
            : `${nodeB.name} is the Foster Parent of ${nodeA.name}`;
        case 'FRIEND':
          return 'Friends';
        case 'BEST_FRIEND':
          return 'Best Friends';
        case 'COWORKER':
          return 'Coworkers';
        case 'COLLEAGUE':
          return 'Colleagues';
        case 'CLASSMATE':
          return 'Classmates';
        case 'NEIGHBOR':
          return 'Neighbors';
        case 'ESTRANGED':
          return 'Estranged / Conflict';
        default:
          return type;
      }
    }

    // 2. Siblings Check (biological, adoptive, foster)
    const getParents = (nodeId: string) => {
      return edges
        .filter(
          (e) =>
            e.target === nodeId &&
            (e.type === 'BIOLOGICAL_PARENT' ||
              e.type === 'ADOPTIVE_PARENT' ||
              e.type === 'FOSTER_PARENT')
        )
        .map((e) => e.source);
    };

    const parentsA = getParents(idA);
    const parentsB = getParents(idB);

    if (parentsA.length > 0 && parentsB.length > 0) {
      const sharedParents = parentsA.filter((p) => parentsB.includes(p));
      if (sharedParents.length > 0) {
        if (sharedParents.length >= 2 || (parentsA.length === 1 && parentsB.length === 1 && sharedParents.length === 1)) {
          return 'Full Siblings';
        } else {
          return 'Half-Siblings';
        }
      }
    }

    // 3. Grandparent / Grandchild Check
    const isGrandparent = (grandparentId: string, grandchildId: string) => {
      const parents = getParents(grandchildId);
      for (const p of parents) {
        const grandparents = getParents(p);
        if (grandparents.includes(grandparentId)) {
          return true;
        }
      }
      return false;
    };

    if (isGrandparent(idA, idB)) {
      return `${nodeA.name} is the Grandparent of ${nodeB.name}`;
    }
    if (isGrandparent(idB, idA)) {
      return `${nodeB.name} is the Grandparent of ${nodeA.name}`;
    }

    // 4. Uncle/Aunt / Nephew/Niece Check
    const areSiblings = (nodeIdX: string, nodeIdY: string) => {
      const pX = getParents(nodeIdX);
      const pY = getParents(nodeIdY);
      if (pX.length === 0 || pY.length === 0) return false;
      return pX.some((p) => pY.includes(p));
    };

    const isUncleAunt = (adultId: string, childId: string) => {
      const parents = getParents(childId);
      for (const p of parents) {
        if (areSiblings(p, adultId)) {
          return true;
        }
      }
      return false;
    };

    if (isUncleAunt(idA, idB)) {
      return `${nodeA.name} is the Uncle/Aunt of ${nodeB.name}`;
    }
    if (isUncleAunt(idB, idA)) {
      return `${nodeB.name} is the Uncle/Aunt of ${nodeA.name}`;
    }

    // 5. First Cousins Check
    const areCousins = (idX: string, idY: string) => {
      const parentsX = getParents(idX);
      const parentsY = getParents(idY);
      for (const pX of parentsX) {
        for (const pY of parentsY) {
          if (areSiblings(pX, pY)) {
            return true;
          }
        }
      }
      return false;
    };

    if (areCousins(idA, idB)) {
      return 'First Cousins';
    }

    return 'No direct relationship found';
  };

  // Auto-calculated fields
  const getSelectedNodeAge = (node: TreeNode) => {
    if (!node.dob) return 'Unknown Age';
    const dobDate = new Date(node.dob);
    const endDate = node.lifeStatus === 'DECEASED' && node.dod ? new Date(node.dod) : new Date();
    let age = endDate.getFullYear() - dobDate.getFullYear();
    const monthDiff = endDate.getMonth() - dobDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && endDate.getDate() < dobDate.getDate())) {
      age--;
    }
    return `${age} years old`;
  };

  const activeNodeInInspector = nodes.find((n) => n.id === selectedNodeId);
  const activeNodeImage = activeNodeInInspector && liveImages.find((img: ImageAsset) => img.id === activeNodeInInspector.imageBlobId)?.blobData;

  const lodMode = getLoDMode();

  return (
    <div className="workspace-container">
      {/* 1. Control Ribbon Header */}
      <nav className="control-ribbon">
        {/* Back and Title */}
        <div className="brand-wrapper">
          <button onClick={onBackToHome} className="btn-back">
            ← Home
          </button>
          <div className="hidden md:block">
            <h1 className="brand-title">
              LineaTree <span className="brand-badge">{readOnly ? 'Preview Sandbox' : 'Workspace'}</span>
            </h1>
          </div>
        </div>

        {/* Autocomplete Node Search Bar */}
        <div className="search-container">
          <div className="search-bar">
            <SearchIcon className="mr-2" size={14} style={{ opacity: 0.5 }} />
            <input
              type="text"
              placeholder="Search individual name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => setShowSearchResults(true)}
              className="search-input"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ color: '#E06C75', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
            )}
          </div>
          {/* Autocomplete Search Dropdown */}
          <AnimatePresence>
            {showSearchResults && filteredSearchNodes.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="autocomplete-dropdown"
              >
                {filteredSearchNodes.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleSearchSelect(n.id)}
                    className="autocomplete-item"
                  >
                    <span style={{ fontWeight: 'bold' }}>{n.name}</span>
                    <span style={{ color: '#56B6C2' }}>{n.sex} • {nodeLevels.current[n.id] !== undefined ? `G${nodeLevels.current[n.id] + 1}` : 'G?'}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* View Mode & Zoom Toggles */}
        <div className="controls-wrapper desktop-only">
          {/* Zoom controls */}
          <div className="zoom-controls">
            <button
              onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
              className="btn-zoom"
              title="Zoom Out"
            >
              <ZoomOutIcon size={14} />
            </button>
            <span className="zoom-value">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2.0, z + 0.1))}
              className="btn-zoom"
              title="Zoom In"
            >
              <ZoomInIcon size={14} />
            </button>
            <button
              onClick={() => {
                setZoom(0.85);
                setPanX(60);
                setPanY(100);
              }}
              className="btn-zoom"
              style={{ color: '#56B6C2', borderLeft: '1px solid rgba(171, 178, 191, 0.15)' }}
              title="Reset View"
            >
              <ResetIcon size={14} />
            </button>
          </div>

          {/* Level of Detail selection */}
          <div className="view-modes">
            {(['SYMBOLIC', 'NAMES', 'FULL'] as const).map((m) => (
              <button
                key={m}
                onClick={() => handleSetViewMode(m)}
                className={`btn-mode ${lodMode === m ? 'active' : ''}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Action controls */}
        <div className="action-controls desktop-only">
          {!readOnly && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsTopBarActionsOpen(!isTopBarActionsOpen);
                }}
                className="btn-action-save"
                style={{
                  background: 'rgba(229, 192, 123, 0.08)',
                  borderColor: 'rgba(229, 192, 123, 0.25)',
                  color: '#E5C07B',
                  marginRight: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>⚡ Pedigree Actions</span>
                <span style={{ fontSize: '9px' }}>{isTopBarActionsOpen ? '▲' : '▼'}</span>
              </button>

              {isTopBarActionsOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    background: '#21252B',
                    border: '1px solid rgba(229, 192, 123, 0.3)',
                    borderRadius: '8px',
                    marginTop: '8px',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                    zIndex: 200,
                    width: '200px',
                    overflow: 'hidden'
                  }}
                >
                  <button
                    onClick={() => {
                      handleAddIndependentNode(
                        (window.innerWidth / 2 - panX) / zoom,
                        (window.innerHeight / 2 - panY) / zoom
                      );
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: '#ABB2BF',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                    }}
                  >
                    <span>👤</span> <span>+ Person</span>
                  </button>

                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddSpouse(selectedNodeId);
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: selectedNodeIds.length === 1 ? '#ABB2BF' : '#555',
                      textAlign: 'left',
                      cursor: selectedNodeIds.length === 1 ? 'pointer' : 'not-allowed',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                    }}
                  >
                    <span>👩‍❤️‍👨</span> <span>+ Spouse</span>
                  </button>

                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddParent(selectedNodeId);
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: selectedNodeIds.length === 1 ? '#ABB2BF' : '#555',
                      textAlign: 'left',
                      cursor: selectedNodeIds.length === 1 ? 'pointer' : 'not-allowed',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                    }}
                  >
                    <span>👪</span> <span>+ Parents</span>
                  </button>

                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddChild(selectedNodeId);
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: selectedNodeIds.length === 1 ? '#ABB2BF' : '#555',
                      textAlign: 'left',
                      cursor: selectedNodeIds.length === 1 ? 'pointer' : 'not-allowed',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                    }}
                  >
                    <span>👶</span> <span>+ Child</span>
                  </button>

                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddSibling(selectedNodeId);
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: selectedNodeIds.length === 1 ? '#ABB2BF' : '#555',
                      textAlign: 'left',
                      cursor: selectedNodeIds.length === 1 ? 'pointer' : 'not-allowed',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                    }}
                  >
                    <span>👥</span> <span>+ Sibling</span>
                  </button>

                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) setRelationMode({ sourceId: selectedNodeId, actionType: 'SOCIAL' });
                      setIsTopBarActionsOpen(false);
                    }}
                    className="context-menu-item"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      color: selectedNodeIds.length === 1 ? '#ABB2BF' : '#555',
                      textAlign: 'left',
                      cursor: selectedNodeIds.length === 1 ? 'pointer' : 'not-allowed',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px'
                    }}
                  >
                    <span>🔗</span> <span>Social Link</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {isInstallable && (
            <button
              onClick={onInstallPWA}
              className="btn-action-save"
              style={{
                background: 'rgba(97, 175, 239, 0.08)',
                borderColor: 'rgba(97, 175, 239, 0.25)',
                color: '#61AFEF',
                marginRight: '8px'
              }}
            >
              📲 Install App
            </button>
          )}

          <button
            onClick={() => setShowPrintOptions(true)}
            className="btn-action-print"
          >
            <PrintIcon size={14} />
            <span>Export Graphic</span>
          </button>

          {!readOnly && (
            <button
              onClick={handleExportLtreeArchive}
              className="btn-action-save"
            >
              <ExportIcon size={14} />
              <span>Save .ltree</span>
            </button>
          )}
        </div>

        {/* Mobile Hamburger menu toggle */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="mobile-only btn-hamburger"
          title="Toggle Options"
        >
          <MenuIcon size={18} />
        </button>
      </nav>

      {/* Mobile Menu Overlay Dropdown */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mobile-menu-overlay mobile-only"
          >
            {/* A. Zoom Controls */}
            <div className="field-group">
              <label className="field-label">Zoom Settings</label>
              <div className="zoom-controls" style={{ width: '100%', justifyContent: 'space-between' }}>
                <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))} className="btn-zoom"><ZoomOutIcon size={16} /></button>
                <span className="zoom-value" style={{ fontSize: '12px' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(2.0, z + 0.1))} className="btn-zoom"><ZoomInIcon size={16} /></button>
                <button
                  onClick={() => { setZoom(0.85); setPanX(60); setPanY(100); }}
                  className="btn-zoom"
                  style={{ color: '#56B6C2', borderLeft: '1px solid rgba(171, 178, 191, 0.15)', paddingLeft: '12px' }}
                >
                  Reset View
                </button>
              </div>
            </div>

            {/* B. View Mode Selector */}
            <div className="field-group">
              <label className="field-label">Level of Detail</label>
              <div className="view-modes" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                {(['SYMBOLIC', 'NAMES', 'FULL'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { handleSetViewMode(m); setIsMobileMenuOpen(false); }}
                    className={`btn-mode ${lodMode === m ? 'active' : ''}`}
                    style={{ padding: '10px 0' }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* C. Generations Clamp slider */}
            <div className="field-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="field-label">Generations Limit</label>
                <span className="clamp-badge">Gen {generationClamp + 1}</span>
              </div>
              <input
                type="range"
                min="0"
                max={maxLevel}
                value={generationClamp}
                onChange={(e) => setGenerationClamp(Number(e.target.value))}
                style={{ width: '100%', marginTop: '6px' }}
              />
            </div>

            {/* D. Network visibility checklists */}
            <div className="field-group">
              <label className="field-label">Filter Interpersonal Networks</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px', background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px' }}>
                {Object.entries(visibleLayers).map(([layer, isVisible]) => {
                  let color = '#98C379'; // Friend
                  if (layer === 'COWORKER') color = '#61AFEF';
                  else if (layer === 'CLASSMATE') color = '#C678DD';
                  else if (layer === 'NEIGHBOR') color = '#E5C07B';

                  return (
                    <label key={layer} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() =>
                          setVisibleLayers((prev) => ({
                            ...prev,
                            [layer]: !prev[layer as keyof typeof visibleLayers]
                          }))
                        }
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <span style={{ color, fontWeight: 'bold', fontSize: '12px' }}>{layer}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Mobile Actions (Responsive UX Upgrade) */}
            {!readOnly && (
              <div className="field-group">
                <label className="field-label" style={{ color: '#E5C07B', fontWeight: 'bold' }}>⚡ Pedigree Actions</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' }}>
                  <button
                    onClick={() => {
                      handleAddIndependentNode(
                        (window.innerWidth / 2 - panX) / zoom,
                        (window.innerHeight / 2 - panY) / zoom
                      );
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{ justifyContent: 'center', padding: '10px 0', fontSize: '11px' }}
                  >
                    👤 + Person
                  </button>
                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddSpouse(selectedNodeId);
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontSize: '11px',
                      background: selectedNodeIds.length === 1 ? 'rgba(152, 195, 121, 0.08)' : 'rgba(255,255,255,0.02)',
                      borderColor: selectedNodeIds.length === 1 ? 'rgba(152, 195, 121, 0.25)' : 'rgba(255,255,255,0.05)',
                      color: selectedNodeIds.length === 1 ? '#98C379' : '#555',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4
                    }}
                  >
                    👩‍❤️‍👨 + Spouse
                  </button>
                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddParent(selectedNodeId);
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontSize: '11px',
                      background: selectedNodeIds.length === 1 ? 'rgba(97, 175, 239, 0.08)' : 'rgba(255,255,255,0.02)',
                      borderColor: selectedNodeIds.length === 1 ? 'rgba(97, 175, 239, 0.25)' : 'rgba(255,255,255,0.05)',
                      color: selectedNodeIds.length === 1 ? '#61AFEF' : '#555',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4
                    }}
                  >
                    👪 + Parents
                  </button>
                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddChild(selectedNodeId);
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontSize: '11px',
                      background: selectedNodeIds.length === 1 ? 'rgba(198, 120, 221, 0.08)' : 'rgba(255,255,255,0.02)',
                      borderColor: selectedNodeIds.length === 1 ? 'rgba(198, 120, 221, 0.25)' : 'rgba(255,255,255,0.05)',
                      color: selectedNodeIds.length === 1 ? '#C678DD' : '#555',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4
                    }}
                  >
                    👶 + Child
                  </button>
                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) handleQuickAddSibling(selectedNodeId);
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontSize: '11px',
                      background: selectedNodeIds.length === 1 ? 'rgba(229, 192, 123, 0.08)' : 'rgba(255,255,255,0.02)',
                      borderColor: selectedNodeIds.length === 1 ? 'rgba(229, 192, 123, 0.25)' : 'rgba(255,255,255,0.05)',
                      color: selectedNodeIds.length === 1 ? '#E5C07B' : '#555',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4
                    }}
                  >
                    👥 + Sibling
                  </button>
                  <button
                    disabled={selectedNodeIds.length !== 1}
                    onClick={() => {
                      if (selectedNodeId) setRelationMode({ sourceId: selectedNodeId, actionType: 'SOCIAL' });
                      setIsMobileMenuOpen(false);
                    }}
                    className="btn-action-save"
                    style={{
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontSize: '11px',
                      background: selectedNodeIds.length === 1 ? 'rgba(97, 175, 239, 0.08)' : 'rgba(255,255,255,0.02)',
                      borderColor: selectedNodeIds.length === 1 ? 'rgba(97, 175, 239, 0.25)' : 'rgba(255,255,255,0.05)',
                      color: selectedNodeIds.length === 1 ? '#61AFEF' : '#555',
                      opacity: selectedNodeIds.length === 1 ? 1 : 0.4
                    }}
                  >
                    🔗 Social Link
                  </button>
                </div>
              </div>
            )}

            {/* E. Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                onClick={() => { setShowPrintOptions(true); setIsMobileMenuOpen(false); }}
                className="btn-action-print"
                style={{ flex: 1, justifyContent: 'center', background: 'rgba(229, 192, 123, 0.08)', border: '1px solid rgba(229, 192, 123, 0.25)', padding: '12px' }}
              >
                <PrintIcon size={16} />
                <span>Print PDF</span>
              </button>
              {!readOnly && (
                <button
                  onClick={() => { handleExportLtreeArchive(); setIsMobileMenuOpen(false); }}
                  className="btn-action-save"
                  style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
                >
                  <ExportIcon size={16} />
                  <span>Save .ltree</span>
                </button>
              )}
              {isInstallable && (
                <button
                  onClick={() => { onInstallPWA(); setIsMobileMenuOpen(false); }}
                  className="btn-action-save"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    background: 'rgba(97, 175, 239, 0.08)',
                    borderColor: 'rgba(97, 175, 239, 0.25)',
                    color: '#61AFEF',
                    padding: '12px'
                  }}
                >
                  📲 Install App
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Generation Clamps and Social Visibility Filters */}
      <div className="filter-strip desktop-only">
        {/* Clamp Slider */}
        <div className="slider-group">
          <span className="clamp-label">Generations Limit:</span>
          <input
            type="range"
            min="0"
            max={maxLevel}
            value={generationClamp}
            onChange={(e) => setGenerationClamp(Number(e.target.value))}
          />
          <span className="clamp-badge">
            Gen {generationClamp + 1}
          </span>
        </div>

        {/* Checklist toggles */}
        <div className="checklist-group">
          <span className="filter-label">Filter Networks:</span>
          {Object.entries(visibleLayers).map(([layer, isVisible]) => {
            let color = '#98C379'; // Friend default
            if (layer === 'COWORKER') color = '#61AFEF';
            else if (layer === 'CLASSMATE') color = '#C678DD';
            else if (layer === 'NEIGHBOR') color = '#E5C07B';

            return (
              <label key={layer} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() =>
                    setVisibleLayers((prev) => ({
                      ...prev,
                      [layer]: !prev[layer as keyof typeof visibleLayers]
                    }))
                  }
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ color, fontWeight: 'bold' }}>
                  {layer}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 3. Main Editor Interactive Canvas */}
      <div
        ref={canvasRef}
        className="canvas-wrapper"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onWheel={handleCanvasWheel}
        onTouchStart={handleCanvasTouchStart}
        onTouchMove={handleCanvasTouchMove}
        onTouchEnd={handleCanvasTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          if (readOnly) return;
          
          // Open background canvas context menu at cursor
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX;
          const y = e.clientY;
          
          // Convert client coordinates into graph coordinates!
          const canvasX = (x - rect.left - panX) / zoom;
          const canvasY = (y - rect.top - panY) / zoom;
          
          setContextMenu({
            x,
            y,
            canvasX,
            canvasY
          });
        }}
        style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}
      >
        <svg className="w-full h-full block">
          {/* Zoom & Pan Group wrapper */}
          <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>
            
            {/* A. SPOUSE / MARRIAGE / ORTHOGONAL LINES LAYER */}
            <g id="marriage-lines">
              {edges
                .filter(
                  (e) =>
                    e.type === 'SPOUSE' ||
                    e.type === 'CONSANGUINOUS' ||
                    e.type === 'DIVORCED' ||
                    e.type === 'FIANCE' ||
                    e.type === 'SEPARATED' ||
                    e.type === 'EX_PARTNER'
                )
                .map((edge) => {
                  const sNode = positionedNodes.find((n) => n.id === edge.source);
                  const tNode = positionedNodes.find((n) => n.id === edge.target);

                  if (!sNode || !tNode) return null;
                  if (!isVisibleNode(sNode.id) || !isVisibleNode(tNode.id)) return null;

                  const yMid = (sNode.y + tNode.y) / 2;
                  const xStart = Math.min(sNode.x, tNode.x);
                  const xEnd = Math.max(sNode.x, tNode.x);

                  let stroke = '#ABB2BF';
                  let dash = 'none';
                  let double = false;
                  let divorced = false;

                  if (edge.type === 'CONSANGUINOUS') {
                    stroke = '#E5C07B';
                    double = true;
                  } else if (edge.type === 'DIVORCED' || edge.type === 'EX_PARTNER') {
                    stroke = '#E06C75';
                    divorced = true;
                  } else if (edge.type === 'FIANCE') {
                    stroke = '#61AFEF';
                    dash = '6,4';
                  } else if (edge.type === 'SEPARATED') {
                    stroke = '#E06C75';
                    dash = '4,4';
                  }

                  return (
                    <g key={edge.id}>
                      {double ? (
                        <>
                          <line x1={xStart} y1={yMid - 2} x2={xEnd} y2={yMid - 2} stroke={stroke} strokeWidth="2.5" />
                          <line x1={xStart} y1={yMid + 2} x2={xEnd} y2={yMid + 2} stroke={stroke} strokeWidth="2.5" />
                        </>
                      ) : (
                        <line
                          x1={xStart}
                          y1={yMid}
                          x2={xEnd}
                          y2={yMid}
                          stroke={stroke}
                          strokeWidth="2"
                          strokeDasharray={dash}
                        />
                      )}
                      {/* Divorced interrupt visual */}
                      {divorced && (
                        <g transform={`translate(${(xStart + xEnd) / 2}, ${yMid})`}>
                          <line x1="-6" y1="10" x2="6" y2="-10" stroke="#E06C75" strokeWidth="3" />
                          <line x1="-2" y1="10" x2="10" y2="-10" stroke="#E06C75" strokeWidth="3" />
                        </g>
                      )}
                    </g>
                  );
                })}
            </g>

            {/* B. CHILDREN PARENT DROPDOWNS LAYER */}
            <g id="parent-child-lines">
              {(() => {
                // Group children by parent set
                const parentChildEdges = edges.filter(
                  (e) =>
                    e.type === 'BIOLOGICAL_PARENT' ||
                    e.type === 'ADOPTIVE_PARENT' ||
                    e.type === 'FOSTER_PARENT'
                );

                // Map: childId -> Array of parent edges targeting this child
                const childToParentsMap = new Map<string, typeof parentChildEdges>();
                parentChildEdges.forEach((edge) => {
                  if (!childToParentsMap.has(edge.target)) {
                    childToParentsMap.set(edge.target, []);
                  }
                  childToParentsMap.get(edge.target)!.push(edge);
                });

                // Group by parent list key
                const groups = new Map<string, {
                  parents: string[];
                  children: {
                    childId: string;
                    edges: typeof parentChildEdges;
                  }[];
                }>();

                childToParentsMap.forEach((pEdges, childId) => {
                  const validPEdges = pEdges.filter(pe => positionedNodes.some(n => n.id === pe.source));
                  if (validPEdges.length === 0) return;

                  const parentIds = validPEdges.map((pe) => pe.source).sort();
                  const parentKey = parentIds.join(',');

                  if (!groups.has(parentKey)) {
                    groups.set(parentKey, { parents: parentIds, children: [] });
                  }
                  groups.get(parentKey)!.children.push({ childId, edges: validPEdges });
                });

                // Now render each group
                const renderedPaths: React.ReactNode[] = [];

                groups.forEach((group, parentKey) => {
                  if (group.parents.length === 2) {
                    const p1 = positionedNodes.find((n) => n.id === group.parents[0]);
                    const p2 = positionedNodes.find((n) => n.id === group.parents[1]);

                    if (p1 && p2) {
                      const parentX = (p1.x + p2.x) / 2;
                      const parentY = (p1.y + p2.y) / 2;
                      const yBar = parentY + 120;

                      const childNodes = group.children
                        .map((c) => positionedNodes.find((n) => n.id === c.childId))
                        .filter(Boolean) as PositionedNode[];

                      if (childNodes.length > 0) {
                        const childXs = childNodes.map((c) => c.x);
                        const minX = Math.min(...childXs, parentX);
                        const maxX = Math.max(...childXs, parentX);

                        // 1. Spousal drop line
                        renderedPaths.push(
                          <line
                            key={`drop-${parentKey}`}
                            x1={parentX}
                            y1={parentY}
                            x2={parentX}
                            y2={yBar}
                            stroke="#ABB2BF"
                            strokeWidth="2"
                          />
                        );

                        // 2. Sibling horizontal bar (only if we have horizontal offset)
                        if (maxX > minX) {
                          renderedPaths.push(
                            <line
                              key={`bar-${parentKey}`}
                              x1={minX}
                              y1={yBar}
                              x2={maxX}
                              y2={yBar}
                              stroke="#ABB2BF"
                              strokeWidth="2"
                            />
                          );
                        }

                        // 3. Child drops
                        group.children.forEach(({ childId, edges: cEdges }) => {
                          const cNode = positionedNodes.find((n) => n.id === childId);
                          if (!cNode) return;

                          const primaryEdge =
                            cEdges.find((e) => e.type === 'ADOPTIVE_PARENT') ||
                            cEdges.find((e) => e.type === 'FOSTER_PARENT') ||
                            cEdges[0];

                          let dash = 'none';
                          let stroke = '#ABB2BF';

                          if (primaryEdge.type === 'ADOPTIVE_PARENT') {
                            dash = '5,5';
                            stroke = '#56B6C2';
                          } else if (primaryEdge.type === 'FOSTER_PARENT') {
                            dash = '2,3';
                            stroke = '#E5C07B';
                          }

                          renderedPaths.push(
                            <line
                              key={`c-drop-${parentKey}-${childId}`}
                              x1={cNode.x}
                              y1={yBar}
                              x2={cNode.x}
                              y2={cNode.y}
                              stroke={stroke}
                              strokeWidth="2"
                              strokeDasharray={dash}
                            />
                          );
                        });
                      }
                    }
                  } else {
                    // Fallback for single parent or weird multiple parents
                    group.children.forEach(({ childId, edges: cEdges }) => {
                      const cNode = positionedNodes.find((n) => n.id === childId);
                      if (!cNode) return;

                      cEdges.forEach((edge) => {
                        const sNode = positionedNodes.find((n) => n.id === edge.source);
                        if (!sNode) return;

                        const midY = (sNode.y + cNode.y) / 2;
                        let dash = 'none';
                        let stroke = '#ABB2BF';

                        if (edge.type === 'ADOPTIVE_PARENT') {
                          dash = '5,5';
                          stroke = '#56B6C2';
                        } else if (edge.type === 'FOSTER_PARENT') {
                          dash = '2,3';
                          stroke = '#E5C07B';
                        }

                        renderedPaths.push(
                          <path
                            key={edge.id}
                            d={`M ${sNode.x} ${sNode.y} L ${sNode.x} ${midY} L ${cNode.x} ${midY} L ${cNode.x} ${cNode.y}`}
                            fill="none"
                            stroke={stroke}
                            strokeWidth="2"
                            strokeDasharray={dash}
                          />
                        );
                      });
                    });
                  }
                });

                return renderedPaths;
              })()}
            </g>

            {/* C. CUBIC BEZIER SOCIAL NETWORKS LAYER */}
            <g id="social-networks">
              {edges
                .filter(
                  (e) =>
                    e.type === 'FRIEND' ||
                    e.type === 'BEST_FRIEND' ||
                    e.type === 'NEIGHBOR' ||
                    e.type === 'COWORKER' ||
                    e.type === 'COLLEAGUE' ||
                    e.type === 'CLASSMATE' ||
                    e.type === 'ESTRANGED'
                )
                .map((edge) => {
                  // Filter out unchecked layers
                  const baseLayer =
                    edge.type === 'FRIEND' || edge.type === 'BEST_FRIEND'
                      ? 'FRIEND'
                      : edge.type === 'COWORKER' || edge.type === 'COLLEAGUE'
                      ? 'COWORKER'
                      : edge.type === 'CLASSMATE'
                      ? 'CLASSMATE'
                      : edge.type === 'NEIGHBOR'
                      ? 'NEIGHBOR'
                      : null;

                  if (baseLayer && !visibleLayers[baseLayer]) return null;

                  const sNode = positionedNodes.find((n) => n.id === edge.source);
                  const tNode = positionedNodes.find((n) => n.id === edge.target);

                  if (!sNode || !tNode) return null;
                  if (!isVisibleNode(sNode.id) || !isVisibleNode(tNode.id)) return null;

                  // Hardware accelerated opacity drop for social ties inside Symbolic Mode
                  const opacity = lodMode === 'SYMBOLIC' ? 0 : 1;

                  const dx = tNode.x - sNode.x;
                  const dy = tNode.y - sNode.y;
                  const offset = Math.min(180, Math.hypot(dx, dy) * 0.35);
                  const cpx1 = sNode.x + dx * 0.25;
                  const cpy1 = sNode.y + dy * 0.25 - offset;
                  const cpx2 = sNode.x + dx * 0.75;
                  const cpy2 = sNode.y + dy * 0.75 - offset;

                  let color = '#98C379'; // FRIEND
                  let dash = 'none';
                  let label = '';
                  let isEst = edge.type === 'ESTRANGED';

                  if (edge.type === 'COWORKER' || edge.type === 'COLLEAGUE') {
                    color = '#61AFEF';
                    dash = '12,6';
                    label = 'W';
                  } else if (edge.type === 'CLASSMATE') {
                    color = '#C678DD';
                    dash = '8,4,2,4';
                    label = 'U';
                  } else if (edge.type === 'NEIGHBOR') {
                    color = '#E5C07B';
                    dash = '2,4';
                    label = 'N';
                  } else if (edge.type === 'ESTRANGED') {
                    color = '#E06C75';
                  }

                  if (isEst) {
                    // Jagged lightning vector path
                    const steps = 14;
                    let pathD = `M ${sNode.x} ${sNode.y}`;
                    for (let i = 1; i <= steps; i++) {
                      const r = i / steps;
                      const bx = sNode.x + dx * r;
                      const by = sNode.y + dy * r;
                      const px = -dy;
                      const py = dx;
                      const pl = Math.hypot(px, py);
                      const amp = i % 2 === 0 ? 10 : -10;
                      const ox = (px / pl) * amp;
                      const oy = (py / pl) * amp;
                      pathD += ` L ${bx + ox} ${by + oy}`;
                    }
                    return (
                      <path
                        key={edge.id}
                        d={pathD}
                        fill="none"
                        stroke={color}
                        strokeWidth="2.5"
                        style={{ opacity, transition: 'opacity 0.2s ease' }}
                      />
                    );
                  }

                  // Standard Bezier Curve
                  const dPath = `M ${sNode.x} ${sNode.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${tNode.x} ${tNode.y}`;

                  // Find midpoint for badge (t=0.5)
                  const t = 0.5;
                  const midX = (1 - t) ** 3 * sNode.x + 3 * (1 - t) ** 2 * t * cpx1 + 3 * (1 - t) * t ** 2 * cpx2 + t ** 3 * tNode.x;
                  const midY = (1 - t) ** 3 * sNode.y + 3 * (1 - t) ** 2 * t * cpy1 + 3 * (1 - t) * t ** 2 * cpy2 + t ** 3 * tNode.y;

                  return (
                    <g key={edge.id} style={{ opacity, transition: 'opacity 0.2s ease' }}>
                      <path d={dPath} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={dash} />
                      {label && lodMode === 'FULL' && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <circle r="9" fill={color} />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            style={{ fill: '#1E222B', fontSize: '9px', fontWeight: '800' }}
                          >
                            {label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
            </g>

            {/* D. GEOMETRIC NODES & DETAILED CARDS LAYER */}
            <g id="individual-nodes">
              {positionedNodes
                .filter((node) => isVisibleNode(node.id))
                .map((node) => {
                  const size = 62;
                  const half = size / 2;
                  const isSelected = selectedNodeIds.includes(node.id);

                  // Map genotype trait color highlights
                  let highlightColor = '#282C34';
                  if (node.traits.includes('BRCA1 Carrier') || node.traits.includes('Hemophilia Carrier')) {
                    highlightColor = '#E06C75';
                  } else if (node.traits.includes('Hypertension') || node.traits.includes('Gout')) {
                    highlightColor = '#E5C07B';
                  } else if (node.traits.length > 0) {
                    highlightColor = '#56B6C2';
                  }

                  const nodeImage = liveImages.find((img: ImageAsset) => img.id === node.imageBlobId)?.blobData;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="group"
                    >
                      {/* Selection Aura */}
                      {isSelected && (
                        <circle cx="0" cy="0" r={half + 6} fill="none" stroke="#61AFEF" strokeWidth="2.5" strokeDasharray="4,4" className="animate-spin-slow" />
                      )}

                      {/* --- A. SYMBOLIC VIEW MODE (zoom < 0.35) --- */}
                      {lodMode === 'SYMBOLIC' && (
                        <g
                          onMouseDown={(e) => handleNodeDragStart(e, node.id)}
                          onTouchStart={(e) => handleNodeTouchStart(e, node.id)}
                          onClick={(e) => handleNodeClick(e, node.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (readOnly) return;
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              nodeId: node.id
                            });
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {node.sex === 'M' ? (
                            <rect x={-half} y={-half} width={size} height={size} fill={highlightColor !== '#282C34' ? highlightColor : '#282C34'} stroke="#ABB2BF" strokeWidth="2.5" rx="3" />
                          ) : node.sex === 'F' ? (
                            <circle cx="0" cy="0" r={half} fill={highlightColor !== '#282C34' ? highlightColor : '#282C34'} stroke="#ABB2BF" strokeWidth="2.5" />
                          ) : (
                            <path d={`M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z`} fill={highlightColor !== '#282C34' ? highlightColor : '#282C34'} stroke="#ABB2BF" strokeWidth="2.5" />
                          )}
                          {node.lifeStatus === 'DECEASED' && (
                            <line x1={-half} y1={half} x2={half} y2={-half} stroke="#E06C75" strokeWidth="3" />
                          )}
                        </g>
                      )}

                      {/* --- B. NAMES VIEW MODE (0.35 <= zoom <= 0.75) --- */}
                      {lodMode === 'NAMES' && (
                        <g
                          onMouseDown={(e) => handleNodeDragStart(e, node.id)}
                          onTouchStart={(e) => handleNodeTouchStart(e, node.id)}
                          onClick={(e) => handleNodeClick(e, node.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (readOnly) return;
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              nodeId: node.id
                            });
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* Base shape */}
                          {node.sex === 'M' ? (
                            <rect x={-half} y={-half} width={size} height={size} fill="#282C34" stroke={isSelected ? '#61AFEF' : 'rgba(171,178,191,0.4)'} strokeWidth="2" rx="4" />
                          ) : node.sex === 'F' ? (
                            <circle cx="0" cy="0" r={half} fill="#282C34" stroke={isSelected ? '#61AFEF' : 'rgba(171,178,191,0.4)'} strokeWidth="2" />
                          ) : (
                            <path d={`M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z`} fill="#282C34" stroke={isSelected ? '#61AFEF' : 'rgba(171,178,191,0.4)'} strokeWidth="2" />
                          )}
                          
                          {/* Trait indicator dot */}
                          {highlightColor !== '#282C34' && (
                            <circle cx={half - 6} cy={-half + 6} r="5" fill={highlightColor} />
                          )}

                          {node.lifeStatus === 'DECEASED' && (
                            <line x1={-half} y1={half} x2={half} y2={-half} stroke="#E06C75" strokeWidth="2.5" />
                          )}

                          {/* Typographic Label below */}
                          <text x="0" y={half + 16} style={{ fill: '#ABB2BF', fontSize: '11px', fontWeight: 'bold' }} textAnchor="middle">
                            {node.chosenName || node.name}
                          </text>
                          <text x="0" y={half + 28} style={{ fill: 'rgba(171, 178, 191, 0.5)', fontSize: '9px' }} textAnchor="middle">
                            {node.dob ? `${new Date().getFullYear() - new Date(node.dob).getFullYear()} yrs` : 'Age ?'}
                          </text>
                        </g>
                      )}

                      {/* --- C. FULL DETAIL VIEW MODE (zoom > 0.75) --- */}
                      {lodMode === 'FULL' && (
                        <g>
                          {/* SVG ForeignObject nesting a gorgeous mobile/desktop HTML5 layout */}
                          <foreignObject
                            x="-100"
                            y="-45"
                            width="200"
                            height="90"
                            onMouseDown={(e) => handleNodeDragStart(e, node.id)}
                            onTouchStart={(e) => handleNodeTouchStart(e, node.id)}
                            onClick={(e) => handleNodeClick(e, node.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (readOnly) return;
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                nodeId: node.id
                              });
                            }}
                          >
                            <div
                              style={{
                                background: 'rgba(40, 44, 52, 0.75)',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                                width: '100%',
                                height: '100%',
                                borderRadius: '12px',
                                border: isSelected ? '1px solid #61AFEF' : '1px solid rgba(255, 255, 255, 0.1)',
                                padding: '10px',
                                display: 'flex',
                                gap: '10px',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                userSelect: 'none',
                                transition: 'all 0.2s ease',
                                boxShadow: isSelected ? '0 0 12px rgba(97, 175, 239, 0.3)' : 'none'
                              }}
                            >
                              {/* Left Profile image crop container */}
                              <div
                                style={{
                                  width: '48px',
                                  height: '48px',
                                  overflow: 'hidden',
                                  flexShrink: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: isSelected ? '2px solid rgba(97, 175, 239, 0.5)' : '2px solid rgba(171, 178, 191, 0.15)',
                                  borderRadius: node.sex === 'M' ? '4px' : '50%',
                                  background: 'rgba(0, 0, 0, 0.1)'
                                }}
                              >
                                {nodeImage ? (
                                  <img src={nodeImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                ) : (
                                  <UserIcon size={20} style={{ opacity: 0.3 }} />
                                )}
                              </div>

                              {/* Info Content */}
                              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                <h4 style={{ fontSize: '11px', fontWeight: 'bold', color: '#ABB2BF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                                  {node.chosenName || node.name}
                                </h4>
                                <p style={{ fontSize: '9px', color: 'rgba(171, 178, 191, 0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                                  {node.job || 'No Title'}
                                </p>
                                {/* Traits micro-badges */}
                                <div style={{ display: 'flex', gap: '4px', marginTop: '4px', overflow: 'hidden' }}>
                                  {node.traits.slice(0, 2).map((t, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        fontSize: '7px',
                                        padding: '1px 6px',
                                        borderRadius: '999px',
                                        fontWeight: 'bold',
                                        textTransform: 'uppercase',
                                        background: t.includes('BRCA1') || t.includes('Hemophilia') ? 'rgba(224, 108, 117, 0.2)' : 'rgba(229, 192, 123, 0.2)',
                                        color: t.includes('BRCA1') || t.includes('Hemophilia') ? '#E06C75' : '#E5C07B'
                                      }}
                                    >
                                      {t.substring(0, 6)}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {/* Deceased cross slash indicator */}
                              {node.lifeStatus === 'DECEASED' && (
                                <div style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(224, 108, 117, 0.1)',
                                  border: '1px solid rgba(224, 108, 117, 0.4)',
                                  borderRadius: '12px',
                                  pointerEvents: 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    width: '120%',
                                    height: '2px',
                                    background: 'rgba(224, 108, 117, 0.4)',
                                    transform: 'rotate(22deg)'
                                  }} />
                                </div>
                              )}
                            </div>
                          </foreignObject>

                          {/* Quick Floating Action Rings (appear on selected node) */}
                          {isSelected && !readOnly && (
                            <g transform="translate(0, 58)" className="animate-fade-in">
                              {/* Add Spouse (+) */}
                              <g
                                transform="translate(-40, 0)"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuickAddSpouse(node.id);
                                }}
                              >
                                <circle r="12" className="floating-add-spouse" />
                                <text textAnchor="middle" dominantBaseline="central" style={{ fill: '#1E222B', fontSize: '10px', fontWeight: '900' }}>+</text>
                              </g>
                              {/* Add Parent (^) */}
                              <g
                                transform="translate(0, 0)"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuickAddParent(node.id);
                                }}
                              >
                                <circle r="12" className="floating-add-parent" />
                                <text textAnchor="middle" dominantBaseline="central" style={{ fill: '#1E222B', fontSize: '10px', fontWeight: '900' }}>^</text>
                              </g>
                              {/* Connect Social Network (Link) */}
                              <g
                                transform="translate(40, 0)"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRelationMode({ sourceId: node.id, actionType: 'SOCIAL' });
                                }}
                              >
                                <circle r="12" className="floating-add-social" />
                                <text textAnchor="middle" dominantBaseline="central" style={{ fill: '#1E222B', fontSize: '8px', fontWeight: '900' }}>🔗</text>
                              </g>
                            </g>
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}
            </g>
          </g>
        </svg>
      </div>

      {/* 4. Side-Sliding Metadata Inspector Drawer Panel */}
      <AnimatePresence>
        {activeNodeInInspector && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 220 }}
            className="sliding-drawer"
            onTouchStart={(e) => {
              drawerTouchStart.current = e.touches[0].clientX;
            }}
            onTouchMove={(e) => {
              if (drawerTouchStart.current === null) return;
              const deltaX = e.touches[0].clientX - drawerTouchStart.current;
              if (deltaX > 120) {
                setSelectedNodeId(null);
                drawerTouchStart.current = null;
              }
            }}
            onTouchEnd={() => {
              drawerTouchStart.current = null;
            }}
          >
            {/* Header */}
            <div className="drawer-header">
              <div className="drawer-title">
                <UserIcon size={18} />
                <h3>Inspector Panel</h3>
              </div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="drawer-close"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Profile image upload dropzone client-side (Phase 2, Item 2) */}
            <div className="image-dropzone-container">
              <div
                className="image-dropzone-circle"
                style={{
                  borderRadius: activeNodeInInspector.sex === 'M' ? '8px' : '50%'
                }}
              >
                {activeNodeImage ? (
                  <img src={activeNodeImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                ) : (
                  <UserIcon size={40} style={{ opacity: 0.2 }} />
                )}
                {!readOnly && (
                  <label className="image-dropzone-overlay">
                    <span>Downsample</span>
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleCompressAndUploadImage(e, activeNodeInInspector.id)}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}
              </div>

              {/* Take Photo Camera Button */}
              {!readOnly && (
                <button
                  onClick={() => handleOpenCameraModal(activeNodeInInspector.id)}
                  className="btn-confirm animate-fade-in"
                  style={{
                    padding: '6px 12px',
                    fontSize: '10px',
                    marginTop: '12px',
                    background: 'rgba(97, 175, 239, 0.08)',
                    border: '1px solid rgba(97, 175, 239, 0.25)',
                    color: '#61AFEF',
                    width: 'auto',
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(97, 175, 239, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(97, 175, 239, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(97, 175, 239, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(97, 175, 239, 0.25)';
                  }}
                >
                  📷 Take Photo
                </button>
              )}

              <h4 style={{ fontSize: '13px', fontWeight: '900', color: '#ABB2BF', marginTop: '12px' }}>{activeNodeInInspector.name}</h4>
              <p className="home-subtitle" style={{ marginTop: '4px', letterSpacing: '0.15em' }}>
                {getSelectedNodeAge(activeNodeInInspector)}
              </p>
            </div>

            {/* Form Fields */}
            <div className="drawer-form">
              {/* Quick Actions Dropdown (Responsive UX Upgrade) */}
              {!readOnly && (
                <div className="field-group" style={{ position: 'relative', zIndex: 100 }}>
                  <label className="field-label" style={{ color: '#E5C07B', fontWeight: 'bold' }}>👤 Quick Pedigree Actions</label>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsInspectorActionsOpen(!isInspectorActionsOpen);
                    }}
                    className="field-input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(229, 192, 123, 0.08)',
                      border: '1px solid rgba(229, 192, 123, 0.25)',
                      color: '#E5C07B',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontWeight: 'bold',
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px'
                    }}
                  >
                    <span>⚡ Choose Action...</span>
                    <span>{isInspectorActionsOpen ? '▲' : '▼'}</span>
                  </button>
                  
                  {isInspectorActionsOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: '#21252B',
                        border: '1px solid rgba(229, 192, 123, 0.3)',
                        borderRadius: '8px',
                        marginTop: '6px',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                        zIndex: 200,
                        overflow: 'hidden'
                      }}
                    >
                      <button
                        onClick={() => {
                          handleQuickAddSpouse(activeNodeInInspector.id);
                          setIsInspectorActionsOpen(false);
                        }}
                        className="context-menu-item"
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          color: '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                        }}
                      >
                        <span>👩‍❤️‍👨</span> <span>+ Spouse</span>
                      </button>
                      <button
                        onClick={() => {
                          handleQuickAddParent(activeNodeInInspector.id);
                          setIsInspectorActionsOpen(false);
                        }}
                        className="context-menu-item"
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          color: '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                        }}
                      >
                        <span>👪</span> <span>+ Parents</span>
                      </button>
                      <button
                        onClick={() => {
                          handleQuickAddChild(activeNodeInInspector.id);
                          setIsInspectorActionsOpen(false);
                        }}
                        className="context-menu-item"
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          color: '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                        }}
                      >
                        <span>👶</span> <span>+ Child</span>
                      </button>
                      <button
                        onClick={() => {
                          handleQuickAddSibling(activeNodeInInspector.id);
                          setIsInspectorActionsOpen(false);
                        }}
                        className="context-menu-item"
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          color: '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          borderBottom: '1px solid rgba(171, 178, 191, 0.1)'
                        }}
                      >
                        <span>👥</span> <span>+ Sibling</span>
                      </button>
                      <button
                        onClick={() => {
                          setRelationMode({ sourceId: activeNodeInInspector.id, actionType: 'SOCIAL' });
                          setIsInspectorActionsOpen(false);
                        }}
                        className="context-menu-item"
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          color: '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px'
                        }}
                      >
                        <span>🔗</span> <span>Social Link</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Full Name */}
              <div className="field-group">
                <label className="field-label">Legal Name</label>
                <input
                  type="text"
                  disabled={readOnly}
                  value={activeNodeInInspector.name}
                  onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'name', e.target.value)}
                  className="field-input"
                />
              </div>

              {/* Chosen Name */}
              <div className="field-group">
                <label className="field-label">Chosen/Preferred Name</label>
                <input
                  type="text"
                  disabled={readOnly}
                  value={activeNodeInInspector.chosenName || ''}
                  onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'chosenName', e.target.value)}
                  className="field-input"
                />
              </div>

              {/* Sex & Life Status */}
              <div className="grid-fields">
                <div className="field-group">
                  <label className="field-label">Sex</label>
                  <select
                    disabled={readOnly}
                    value={activeNodeInInspector.sex}
                    onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'sex', e.target.value)}
                    className="field-select"
                  >
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="INTERSEX">Intersex</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </div>

                <div className="field-group">
                  <label className="field-label">Status</label>
                  <select
                    disabled={readOnly}
                    value={activeNodeInInspector.lifeStatus}
                    onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'lifeStatus', e.target.value)}
                    className="field-select"
                  >
                    <option value="ALIVE">Alive</option>
                    <option value="DECEASED">Deceased</option>
                    <option value="MISSING">Missing</option>
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div className="grid-fields">
                <div className="field-group">
                  <label className="field-label">Birth Date</label>
                  <input
                    type="date"
                    disabled={readOnly}
                    value={activeNodeInInspector.dob || ''}
                    onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'dob', e.target.value)}
                    className="field-input"
                  />
                </div>

                {activeNodeInInspector.lifeStatus === 'DECEASED' && (
                  <div className="field-group">
                    <label className="field-label" style={{ color: '#E06C75' }}>Deceased Date</label>
                    <input
                      type="date"
                      disabled={readOnly}
                      value={activeNodeInInspector.dod || ''}
                      onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'dod', e.target.value)}
                      className="field-input"
                      style={{ borderColor: 'rgba(224, 108, 117, 0.3)' }}
                    />
                  </div>
                )}
              </div>

              {/* Professional Title & Company */}
              <div className="grid-fields">
                <div className="field-group">
                  <label className="field-label">Job Title</label>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={activeNodeInInspector.job || ''}
                    onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'job', e.target.value)}
                    className="field-input"
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Company</label>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={activeNodeInInspector.company || ''}
                    onChange={(e) => handleUpdateNodeField(activeNodeInInspector.id, 'company', e.target.value)}
                    className="field-input"
                  />
                </div>
              </div>

              {/* Genotypic Traits tags editor */}
              <div className="field-group">
                <label className="field-label">Genotypic Traits</label>
                <div className="tags-wrapper">
                  {activeNodeInInspector.traits.map((t, idx) => (
                    <span
                      key={idx}
                      className="tag-badge"
                    >
                      <span>{t}</span>
                      {!readOnly && (
                        <button
                          onClick={() => handleRemoveTrait(activeNodeInInspector.id, idx)}
                          className="tag-remove"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {activeNodeInInspector.traits.length === 0 && (
                    <span style={{ fontSize: '10px', color: 'rgba(171, 178, 191, 0.3)', fontStyle: 'italic' }}>No traits tagged.</span>
                  )}
                </div>

                {!readOnly && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const input = form.elements.namedItem('traitInput') as HTMLInputElement;
                      handleAddTrait(activeNodeInInspector.id, input.value);
                      input.value = '';
                    }}
                    className="tag-form"
                  >
                    <input
                      name="traitInput"
                      type="text"
                      placeholder="Add genotype trait tag..."
                      className="field-input"
                      style={{ flex: 1, padding: '6px 10px' }}
                    />
                    <button
                      type="submit"
                      className="btn-tag-add"
                    >
                      +
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Delete button (at bottom) */}
            {!readOnly && (
              <div className="drawer-footer">
                <button
                  onClick={() => handleDeleteNode(activeNodeInInspector.id)}
                  className="btn-delete-node"
                >
                  <Trash2Icon size={14} />
                  <span>Delete Individual</span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. Connect Social Overlay Form Modal */}
      <AnimatePresence>
        {relationMode && relationMode.actionType === 'SOCIAL' && (
          <div className="modal-overlay">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#C678DD' }}>
                  <LinkIcon size={16} />
                  <span>Establish Relationship Link</span>
                </h3>
                <button onClick={() => setRelationMode(null)} className="modal-btn-close">×</button>
              </div>

              <div className="field-group">
                <label className="field-label">Target Individual</label>
                {selectedNodeIds.length === 2 ? (
                  <div style={{
                    background: '#21252B',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    color: '#98C379',
                    fontWeight: 'bold'
                  }}>
                    {nodes.find(n => n.id === socialTargetId)?.name || 'Selected Individual'}
                  </div>
                ) : (
                  <select
                    value={socialTargetId}
                    onChange={(e) => setSocialTargetId(e.target.value)}
                    className="field-select"
                    style={{ background: '#21252B' }}
                  >
                    <option value="">Select target individual...</option>
                    {nodes
                      .filter((n) => n.id !== relationMode.sourceId)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="field-group">
                <label className="field-label">Relationship Type</label>
                <select
                  value={socialType}
                  onChange={(e) => setSocialType(e.target.value as any)}
                  className="field-select"
                  style={{ background: '#21252B' }}
                >
                  <option value="SPOUSE">Spouse / Partner</option>
                  <option value="BIOLOGICAL_PARENT">Parent (Biological)</option>
                  <option value="ADOPTIVE_PARENT">Parent (Adoptive)</option>
                  <option value="FOSTER_PARENT">Parent (Foster)</option>
                  <option value="DIVORCED">Divorced</option>
                  <option value="FIANCE">Fiancé / Engaged</option>
                  <option value="SEPARATED">Separated</option>
                  <option value="EX_PARTNER">Ex-Partner</option>
                  <option value="FRIEND">Friend</option>
                  <option value="BEST_FRIEND">Best Friend</option>
                  <option value="COWORKER">Coworker</option>
                  <option value="COLLEAGUE">Colleague</option>
                  <option value="CLASSMATE">Classmate</option>
                  <option value="NEIGHBOR">Neighbor</option>
                  <option value="ESTRANGED">Estranged / Friction</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  onClick={() => setRelationMode(null)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSocialEdge}
                  disabled={!socialTargetId}
                  className="btn-confirm"
                  style={{ background: '#98C379', color: '#1E222B' }}
                >
                  Establish Link
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. Vector PDF & SVG Print Customization Modal Overlay */}
      <AnimatePresence>
        {showPrintOptions && (
          <div className="modal-overlay">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
              style={{ maxWidth: '520px' }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#E5C07B' }}>
                  <PrintIcon size={16} />
                  <span>Configure Vector PDF Export</span>
                </h3>
                <button onClick={() => setShowPrintOptions(false)} className="modal-btn-close">×</button>
              </div>

              {/* Layout Profile option */}
              <div className="field-group" style={{ gap: '10px' }}>
                <label className="field-label">Scale Viewport Aspect Profile</label>
                <div className="grid-fields">
                  <button
                    onClick={() => setExportLayout('SINGLE_PAGE_BLUEPRINT')}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      border: exportLayout === 'SINGLE_PAGE_BLUEPRINT' ? '1px solid #E5C07B' : '1px solid rgba(255,255,255,0.1)',
                      background: exportLayout === 'SINGLE_PAGE_BLUEPRINT' ? 'rgba(229, 192, 123, 0.05)' : '#21252B',
                      color: exportLayout === 'SINGLE_PAGE_BLUEPRINT' ? '#E5C07B' : '#ABB2BF',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>Single-Page Blueprint</span>
                    <span style={{ fontSize: '9px', opacity: 0.75, lineHeight: 1.3 }}>Auto-scale continuous graph coordinates into massive A0/A1 landscape.</span>
                  </button>
                  <button
                    onClick={() => setExportLayout('MULTI_PAGE_A4_LEDGER')}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      border: exportLayout === 'MULTI_PAGE_A4_LEDGER' ? '1px solid #E5C07B' : '1px solid rgba(255,255,255,0.1)',
                      background: exportLayout === 'MULTI_PAGE_A4_LEDGER' ? 'rgba(229, 192, 123, 0.05)' : '#21252B',
                      color: exportLayout === 'MULTI_PAGE_A4_LEDGER' ? '#E5C07B' : '#ABB2BF',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>Multi-Page Ledger (A4)</span>
                    <span style={{ fontSize: '9px', opacity: 0.75, lineHeight: 1.3 }}>Slice pedigree rows horizontally into standard A4 sheets with alignment grids.</span>
                  </button>
                </div>
              </div>

              {/* Color Themes */}
              <div className="field-group" style={{ gap: '10px' }}>
                <label className="field-label">Color Scheme Customization</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  {(['ONE_DARK', 'MEDICAL_HIGH_CONTEST', 'HERITAGE_ARCHIVE'] as const).map((t) => {
                    let label = 'One Dark Rich';
                    let desc = 'System original palette';
                    if (t === 'MEDICAL_HIGH_CONTEST') {
                      label = 'High Contrast';
                      desc = 'Medical stark black & white';
                    } else if (t === 'HERITAGE_ARCHIVE') {
                      label = 'Heritage Archive';
                      desc = 'Warm cream & navy';
                    }

                    return (
                      <button
                        key={t}
                        onClick={() => setExportTheme(t)}
                        style={{
                          padding: '10px',
                          borderRadius: '12px',
                          border: exportTheme === t ? '1px solid #E5C07B' : '1px solid rgba(255,255,255,0.1)',
                          background: exportTheme === t ? 'rgba(229, 192, 123, 0.05)' : '#21252B',
                          color: exportTheme === t ? '#E5C07B' : '#ABB2BF',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <span style={{ fontWeight: 'bold', fontSize: '10px' }}>{label}</span>
                        <span style={{ fontSize: '8px', opacity: 0.7, lineHeight: 1.3 }}>{desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  onClick={() => setShowPrintOptions(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePrintToVector}
                  className="btn-confirm"
                  style={{ background: '#E5C07B', color: '#1E222B' }}
                >
                  Generate PDF/SVG
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Relationship Badge Overlay (exactly 2 nodes selected) */}
      <AnimatePresence>
        {selectedNodeIds.length === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 150 }}
            style={{
              position: 'absolute',
              bottom: '32px',
              left: '50%',
              zIndex: 45,
              width: '90%',
              maxWidth: '520px',
              background: 'rgba(33, 37, 43, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(97, 175, 239, 0.35)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 16px rgba(97, 175, 239, 0.1)',
              borderRadius: '16px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>📊</span>
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#ABB2BF', letterSpacing: '0.02em' }}>
                  Relation Tracker
                </span>
              </div>
              <button
                onClick={() => setSelectedNodeIds([])}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.3)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Clear Selection
              </button>
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.2)',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '10px',
              borderLeft: '4px solid #61AFEF',
              fontSize: '13px',
              fontWeight: '600',
              color: '#ECEFF4',
              textAlign: 'left'
            }}>
              {getSelectedRelationship()}
            </div>

            <div style={{ display: 'flex', gap: '10px', width: '100%', marginTop: '4px' }}>
              {(() => {
                const [idA, idB] = selectedNodeIds;
                const edge = edges.find((e) => (e.source === idA && e.target === idB) || (e.source === idB && e.target === idA));
                
                if (edge) {
                  return (
                    <button
                      onClick={async () => {
                        setCustomModal({
                          isOpen: true,
                          title: 'Break Relationship',
                          message: 'Are you sure you want to disconnect this relationship between these two individuals?',
                          type: 'CONFIRM',
                          onConfirm: async () => {
                            await db.edges.delete(edge.id);
                            setCustomModal(null);
                          }
                        });
                      }}
                      style={{
                        flex: 1,
                        background: 'rgba(224, 108, 117, 0.1)',
                        border: '1px solid rgba(224, 108, 117, 0.3)',
                        borderRadius: '8px',
                        color: '#E06C75',
                        padding: '8px 12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>✂️</span> Break Tie
                    </button>
                  );
                } else {
                  return (
                    <button
                      onClick={() => {
                        setRelationMode({ sourceId: idA, actionType: 'SOCIAL' });
                        setSocialTargetId(idB);
                      }}
                      style={{
                        flex: 1,
                        background: 'rgba(152, 195, 121, 0.1)',
                        border: '1px solid rgba(152, 195, 121, 0.3)',
                        borderRadius: '8px',
                        color: '#98C379',
                        padding: '8px 12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>➕</span> Establish Link
                    </button>
                  );
                }
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. Custom Glassmorphic Alerts & Confirm Modal */}
      <AnimatePresence>
        {customModal && customModal.isOpen && (
          <div className="modal-overlay" style={{ zIndex: 100 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
              style={{
                maxWidth: '420px',
                border: '1px solid rgba(97, 175, 239, 0.3)',
                boxShadow: '0 0 24px rgba(97, 175, 239, 0.15)'
              }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{
                  color: customModal.type === 'CONFIRM' ? '#E06C75' : '#61AFEF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {customModal.type === 'CONFIRM' ? '⚠️' : 'ℹ️'} {customModal.title}
                </h3>
                <button
                  onClick={() => setCustomModal(null)}
                  className="modal-btn-close"
                >
                  ×
                </button>
              </div>

              <div style={{ margin: '16px 0', fontSize: '13px', color: '#ABB2BF', lineHeight: 1.5 }}>
                {customModal.message}
              </div>

              <div className="modal-actions" style={{ marginTop: '24px' }}>
                {customModal.type === 'CONFIRM' ? (
                  <>
                    <button
                      onClick={() => setCustomModal(null)}
                      className="btn-cancel"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (customModal.onConfirm) {
                          customModal.onConfirm();
                        }
                      }}
                      className="btn-confirm"
                      style={{ background: '#E06C75', color: '#1E222B', fontWeight: 'bold' }}
                    >
                      Confirm Action
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setCustomModal(null)}
                    className="btn-confirm"
                    style={{ background: '#61AFEF', color: '#1E222B', fontWeight: 'bold', width: '100%', justifyContent: 'center' }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 7b. Camera Streaming & Capture Modal Overlay */}
      <AnimatePresence>
        {cameraModalNodeId && (
          <div className="modal-overlay" style={{ zIndex: 10500 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
              style={{
                maxWidth: '440px',
                border: '1px solid rgba(97, 175, 239, 0.3)',
                boxShadow: '0 0 24px rgba(97, 175, 239, 0.15)'
              }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#61AFEF', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📷 Capture Avatar Photo
                </h3>
                <button
                  onClick={handleCloseCameraModal}
                  className="modal-btn-close"
                >
                  ×
                </button>
              </div>

              {cameraError ? (
                /* Permission Error Alert Container */
                <div style={{ padding: '16px', background: 'rgba(224,108,117,0.08)', border: '1px solid rgba(224,108,117,0.2)', borderRadius: '12px', fontSize: '13px', color: '#E06C75', lineHeight: 1.5, textAlign: 'left', margin: '16px 0' }}>
                  ⚠️ {cameraError}
                </div>
              ) : (
                /* Live Camera Stream Video Viewport */
                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', background: '#1E222B', borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      // Mirror the user camera for standard selfie logic!
                      transform: cameraFacingMode === 'user' ? 'scaleX(-1)' : 'none'
                    }}
                  />
                  {/* Central crop viewfinder indicator box */}
                  <div style={{ position: 'absolute', inset: '10px', border: '2px dashed rgba(255,255,255,0.35)', borderRadius: '10px', pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }} />
                </div>
              )}

              <div className="modal-actions" style={{ gap: '12px' }}>
                <button
                  onClick={handleCloseCameraModal}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                
                {!cameraError && (
                  <>
                    <button
                      onClick={handleToggleCameraFacing}
                      className="btn-cancel"
                      style={{ flex: 'none', width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Switch Camera (Front/Back)"
                    >
                      🔄
                    </button>
                    <button
                      onClick={handleCapturePhoto}
                      className="btn-confirm"
                      style={{ background: '#61AFEF', color: '#1E222B', fontWeight: 'bold' }}
                    >
                      Snap Photo
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 8. Custom Glassmorphic Right-Click Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="context-menu"
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.nodeId ? (
              // Individual Card Right-Click Actions
              <>
                <div style={{ padding: '4px 16px', fontSize: '9px', fontWeight: 'bold', color: '#61AFEF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Card Options
                </div>
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) {
                      setSelectedNodeId(contextMenu.nodeId);
                      setSelectedNodeIds([contextMenu.nodeId]);
                    }
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  📝 Edit Details
                </button>
                <div className="context-menu-divider" />
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleQuickAddSpouse(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  ➕ Add Spouse
                </button>
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleQuickAddParent(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  ▲ Add Parents
                </button>
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleQuickAddChild(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  ▼ Add Child
                </button>
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleQuickAddSibling(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  👥 Add Sibling
                </button>
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) setRelationMode({ sourceId: contextMenu.nodeId, actionType: 'SOCIAL' });
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  🔗 Link Social Network
                </button>
                <div className="context-menu-divider" />
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleCopy();
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  🗎 Copy Card
                </button>
                <div className="context-menu-divider" />
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) handleDeleteNode(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                  style={{ color: '#E06C75' }}
                >
                  🗑️ Delete Person
                </button>
              </>
            ) : (
              // Canvas Background Right-Click Actions
              <>
                <div style={{ padding: '4px 16px', fontSize: '9px', fontWeight: 'bold', color: '#98C379', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Canvas Options
                </div>
                <button
                  onClick={() => {
                    if (contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) {
                      handleAddIndependentNode(contextMenu.canvasX, contextMenu.canvasY);
                    }
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  👤 Add Person Here
                </button>
                <button
                  disabled={copiedNodes.current.length === 0}
                  onClick={() => {
                    handlePaste();
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  📋 Paste Copied ({copiedNodes.current.length})
                </button>
                <div className="context-menu-divider" />
                <button
                  onClick={() => {
                    setZoom(0.85);
                    setPanX(60);
                    setPanY(100);
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  🎯 Reset Viewport
                </button>
                <div className="context-menu-divider" />
                <button
                  onClick={() => {
                    handleUndo();
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  ↩ Undo (Ctrl+Z)
                </button>
                <button
                  onClick={() => {
                    handleRedo();
                    setContextMenu(null);
                  }}
                  className="context-menu-item"
                >
                  ↪ Redo (Ctrl+Y)
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 9. Accessible Floating Action Toolbar */}
      {!readOnly && (
        <div className="floating-action-toolbar">
          <button
            onClick={() => handleAddIndependentNode(
              (window.innerWidth / 2 - panX) / zoom,
              (window.innerHeight / 2 - panY) / zoom
            )}
            className="toolbar-btn"
            title="Add independent person at viewport center"
          >
            <span style={{ fontSize: '18px' }}>👤</span>
            <span>+ Person</span>
          </button>
          
          <div className="toolbar-divider" />

          <button
            disabled={selectedNodeIds.length !== 1}
            onClick={() => {
              if (selectedNodeId) handleQuickAddSpouse(selectedNodeId);
            }}
            className={`toolbar-btn ${selectedNodeIds.length === 1 ? 'active-success' : ''}`}
            title="Add spouse/partner to selected person"
          >
            <span style={{ fontSize: '18px' }}>👩‍❤️‍👨</span>
            <span>+ Spouse</span>
          </button>

          <button
            disabled={selectedNodeIds.length !== 1}
            onClick={() => {
              if (selectedNodeId) handleQuickAddParent(selectedNodeId);
            }}
            className={`toolbar-btn ${selectedNodeIds.length === 1 ? 'active-primary' : ''}`}
            title="Add father & mother to selected person"
          >
            <span style={{ fontSize: '18px' }}>👪</span>
            <span>+ Parents</span>
          </button>

          <button
            disabled={selectedNodeIds.length !== 1}
            onClick={() => {
              if (selectedNodeId) handleQuickAddChild(selectedNodeId);
            }}
            className={`toolbar-btn ${selectedNodeIds.length === 1 ? 'active-purple' : ''}`}
            title="Add child to selected person"
          >
            <span style={{ fontSize: '18px' }}>👶</span>
            <span>+ Child</span>
          </button>

          <button
            disabled={selectedNodeIds.length !== 1}
            onClick={() => {
              if (selectedNodeId) handleQuickAddSibling(selectedNodeId);
            }}
            className={`toolbar-btn ${selectedNodeIds.length === 1 ? 'active-orange' : ''}`}
            title="Add sibling to selected person"
          >
            <span style={{ fontSize: '18px' }}>👥</span>
            <span>+ Sibling</span>
          </button>

          <button
            disabled={selectedNodeIds.length !== 1}
            onClick={() => {
              if (selectedNodeId) setRelationMode({ sourceId: selectedNodeId, actionType: 'SOCIAL' });
            }}
            className={`toolbar-btn ${selectedNodeIds.length === 1 ? 'active-primary' : ''}`}
            title="Connect social relationship line"
          >
            <span style={{ fontSize: '18px' }}>🔗</span>
            <span>Social</span>
          </button>

          <div className="toolbar-divider" />

          <button
            disabled={selectedNodeIds.length === 0}
            onClick={handleDeleteSelectedNodes}
            className={`toolbar-btn ${selectedNodeIds.length > 0 ? 'active-danger' : ''}`}
            title="Delete selected person(s) and all connections"
          >
            <span style={{ fontSize: '18px' }}>🗑️</span>
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
};
