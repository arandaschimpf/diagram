import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow, Background, Controls, ControlButton, MiniMap,
  useNodesState, useEdgesState, useReactFlow, getNodesBounds,
  type Node, type Edge, type Connection, type IsValidConnection, type OnNodesChange, type OnEdgesChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import type { TargetKind } from '../editDsl';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';

import {
  EntityNodeComp, EnumNodeComp, EventNodeComp, EventHandlerNodeComp,
  QueryNodeComp, ActionNodeComp, ActorNodeComp, ServiceNodeComp,
  StateMachineNodeComp, TypeNodeComp,
} from './nodes';
import type { Layout } from '../dslToFlow';
import { DiagramCallbackContext } from '../diagramContext';
import { computeAutoLayout } from '../autoLayout';

const nodeTypes = {
  entity: EntityNodeComp,
  enum: EnumNodeComp,
  event: EventNodeComp,
  eventhandler: EventHandlerNodeComp,
  query: QueryNodeComp,
  action: ActionNodeComp,
  actor: ActorNodeComp,
  service: ServiceNodeComp,
  statemachine: StateMachineNodeComp,
  type: TypeNodeComp,
};

const EXPORT_ZOOM = 1.5;
const EXPORT_PADDING = 80;

export type FocusTarget = { nodeId: string; nonce: number };

interface Props {
  nodes: Node[];
  edges: Edge[];
  filename?: string;
  currentLayout: Layout;
  onLayoutChange: (layout: Layout) => void;
  onNodeRightClick?: (nodeId: string, nodeType: string) => void;
  onAddEdge?: (sourceId: string, targetId: string, targetKind: TargetKind) => void;
  onDeleteEdge?: (sourceId: string, targetId: string, targetKind: TargetKind) => void;
  onOpenStateMachine?: (node: import('@diagram/parser').StateMachineNode) => void;
  focusTarget?: FocusTarget | null;
}

const SOURCE_KINDS = new Set(['action', 'eventhandler', 'actor']);
const ACTOR_VALID_TARGETS = new Set(['action', 'query']);
const NON_ACTOR_VALID_TARGETS = new Set(['action', 'query', 'event']);

function targetKindFromNodeType(type: string | undefined): TargetKind | null {
  switch (type) {
    case 'action': return 'Action';
    case 'query': return 'Query';
    case 'event': return 'Event';
    default: return null;
  }
}

const LAYOUT_ANIM_MS = 300;

function nodesToLayout(nodes: Node[]): Layout {
  const layout: Layout = {};
  for (const n of nodes) {
    const entry: Layout[string] = { x: n.position.x, y: n.position.y };
    if (n.type === 'service') {
      const w = n.style?.width;
      const h = n.style?.height;
      if (typeof w === 'number') entry.width = w;
      if (typeof h === 'number') entry.height = h;
    }
    layout[n.id] = entry;
  }
  return layout;
}

function AutoLayoutButton({
  currentLayout,
  setAnimating,
  onLayoutChange,
}: {
  currentLayout: Layout;
  setAnimating: (v: boolean) => void;
  onLayoutChange: (layout: Layout) => void;
}) {
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow();
  const [busy, setBusy] = useState(false);

  const applyResult = useCallback(
    async (mode: 'all' | 'unpositioned') => {
      setBusy(true);
      try {
        const all = getNodes();
        const result = await computeAutoLayout(all, getEdges());
        setAnimating(true);
        setNodes(curr => {
          const isPositioned = (id: string) => Object.prototype.hasOwnProperty.call(currentLayout, id);
          return curr.map(n => {
            const r = result.get(n.id);
            if (!r) return n;
            if (mode === 'unpositioned' && isPositioned(n.id)) return n;
            const next: Node = { ...n, position: { x: r.x, y: r.y } };
            if (n.type === 'service' && r.width != null && r.height != null) {
              next.style = { ...n.style, width: r.width, height: r.height };
            }
            return next;
          });
        });
        setTimeout(() => {
          setAnimating(false);
          onLayoutChange(nodesToLayout(getNodes()));
          fitView({ duration: 300, padding: 0.1 });
        }, LAYOUT_ANIM_MS);
      } finally {
        setBusy(false);
      }
    },
    [getNodes, getEdges, setNodes, currentLayout, setAnimating, onLayoutChange, fitView],
  );

  const handleClick = useCallback(() => {
    if (busy) return;
    const hasLayout = Object.keys(currentLayout).length > 0;
    if (!hasLayout) {
      void applyResult('all');
      return;
    }
    // eslint-disable-next-line no-alert
    const yes = window.confirm(
      'Auto-arrange will reposition all nodes.\n\nOK: reposition everything.\nCancel: only place nodes that have no saved position.',
    );
    void applyResult(yes ? 'all' : 'unpositioned');
  }, [busy, currentLayout, applyResult]);

  return (
    <ControlButton onClick={handleClick} title="Auto-arrange nodes" disabled={busy}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M3 3h7v7H3V3zm11 0h7v4h-7V3zm0 6h7v12h-7V9zM3 12h7v9H3v-9z" />
      </svg>
    </ControlButton>
  );
}

function FocusHandler({ target, setNodes }: { target: FocusTarget | null | undefined; setNodes: (updater: (nodes: Node[]) => Node[]) => void }) {
  const { fitView, getNode } = useReactFlow();
  useEffect(() => {
    if (!target) return;
    const n = getNode(target.nodeId);
    if (!n) return;
    fitView({ nodes: [{ id: target.nodeId }], duration: 400, maxZoom: 1.2, padding: 0.4 });
    setNodes(curr => curr.map(node => ({ ...node, selected: node.id === target.nodeId })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nodeId, target?.nonce]);
  return null;
}

function SavePngButton({ filename }: { filename: string }) {
  const { getNodes } = useReactFlow();

  const handleClick = useCallback(() => {
    const nodes = getNodes();
    if (nodes.length === 0) return;

    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!viewportEl) return;

    const bounds = getNodesBounds(nodes);
    const exportWidth = Math.ceil(bounds.width * EXPORT_ZOOM + 2 * EXPORT_PADDING);
    const exportHeight = Math.ceil(bounds.height * EXPORT_ZOOM + 2 * EXPORT_PADDING);
    const translateX = EXPORT_PADDING - bounds.x * EXPORT_ZOOM;
    const translateY = EXPORT_PADDING - bounds.y * EXPORT_ZOOM;

    // The edges SVG has fixed pixel dimensions matching the visible panel; expand it
    // so edges aren't clipped when we resize the viewport element for export.
    const edgeSvg = viewportEl.querySelector('svg') as SVGElement | null;
    const prevWidth = edgeSvg?.style.width;
    const prevHeight = edgeSvg?.style.height;
    if (edgeSvg) {
      edgeSvg.style.width = `${exportWidth}px`;
      edgeSvg.style.height = `${exportHeight}px`;
    }

    toPng(viewportEl, {
      backgroundColor: '#1a1a1a',
      width: exportWidth,
      height: exportHeight,
      style: {
        width: `${exportWidth}px`,
        height: `${exportHeight}px`,
        transform: `translate(${translateX}px, ${translateY}px) scale(${EXPORT_ZOOM})`,
        transformOrigin: '0 0',
      },
    }).then(dataUrl => {
      if (edgeSvg) {
        edgeSvg.style.width = prevWidth ?? '';
        edgeSvg.style.height = prevHeight ?? '';
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${filename || 'diagram'}.png`;
      a.click();
    });
  }, [getNodes, filename]);

  return (
    <ControlButton onClick={handleClick} title="Save as PNG">
      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
      </svg>
    </ControlButton>
  );
}

function MiniMapWithNavigation() {
  const { fitView } = useReactFlow();
  const handleNodeClick = useCallback((_event: unknown, node: Node) => {
    fitView({ nodes: [{ id: node.id }], duration: 400, maxZoom: 1.2, padding: 0.4 });
  }, [fitView]);
  return (
    <MiniMap
      nodeColor={nodeColor}
      style={{ background: '#1a1a1a' }}
      pannable
      zoomable
      onNodeClick={handleNodeClick}
    />
  );
}

export function DiagramCanvas({ nodes: propNodes, edges: propEdges, filename, currentLayout, onLayoutChange, onNodeRightClick, onAddEdge, onDeleteEdge, onOpenStateMachine, focusTarget }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(propNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(propEdges);
  const [animating, setAnimating] = useState(false);

  useEffect(() => { setNodes(propNodes); }, [propNodes, setNodes]);
  useEffect(() => { setEdges(propEdges); }, [propEdges, setEdges]);

  const isValidConnection: IsValidConnection = useCallback((conn) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false;
    const src = nodes.find(n => n.id === conn.source);
    const dst = nodes.find(n => n.id === conn.target);
    if (!src || !dst) return false;
    if (!SOURCE_KINDS.has(src.type ?? '')) return false;
    const validTargets = src.type === 'actor' ? ACTOR_VALID_TARGETS : NON_ACTOR_VALID_TARGETS;
    return validTargets.has(dst.type ?? '');
  }, [nodes]);

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return;
    const dst = nodes.find(n => n.id === params.target);
    const kind = targetKindFromNodeType(dst?.type);
    if (!kind) return;
    onAddEdge?.(params.source, params.target, kind);
  }, [nodes, onAddEdge]);

  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!onDeleteEdge) return;
    for (const edge of deleted) {
      const dst = nodes.find(n => n.id === edge.target);
      const kind = targetKindFromNodeType(dst?.type);
      if (!kind) continue;
      onDeleteEdge(edge.source, edge.target, kind);
    }
  }, [nodes, onDeleteEdge]);

  const handleNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    e.preventDefault();
    onNodeRightClick?.(node.id, node.type ?? '');
  }, [onNodeRightClick]);

  const handleNodeDragStop = useCallback(() => {
    setNodes(current => {
      const layout: Layout = {};
      current.forEach(n => {
        const entry: Layout[string] = { x: n.position.x, y: n.position.y };
        if (n.type === 'service') {
          const w = n.style?.width;
          const h = n.style?.height;
          if (typeof w === 'number') entry.width = w;
          if (typeof h === 'number') entry.height = h;
        }
        layout[n.id] = entry;
      });
      onLayoutChange(layout);
      return current;
    });
  }, [setNodes, onLayoutChange]);

  return (
    <DiagramCallbackContext.Provider value={{ onLayoutChange, onOpenStateMachine }}>
      <div style={{ flex: 1, height: '100%' }} className={animating ? 'diagram-animating' : undefined}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as OnNodesChange}
          onEdgesChange={onEdgesChange as OnEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onEdgesDelete={handleEdgesDelete}
          onNodeDragStop={handleNodeDragStop}
          onNodeContextMenu={handleNodeContextMenu}
          nodeTypes={nodeTypes}
          fitView
          panActivationKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <FocusHandler target={focusTarget} setNodes={setNodes} />
          <Background color="#333" gap={16} />
          <Controls>
            <AutoLayoutButton currentLayout={currentLayout} setAnimating={setAnimating} onLayoutChange={onLayoutChange} />
            <SavePngButton filename={filename ?? 'diagram'} />
          </Controls>
          <MiniMapWithNavigation />
        </ReactFlow>
      </div>
    </DiagramCallbackContext.Provider>
  );
}

function nodeColor(node: Node): string {
  switch (node.type) {
    case 'entity': return '#4a7fb5';
    case 'type': return '#6b7280';
    case 'event': return '#c9a800';
    case 'eventhandler': return '#c87020';
    case 'query': return '#3a9e55';
    case 'action': return '#3a9e55';
    case 'actor': return '#8040b0';
    default: return '#555';
  }
}
