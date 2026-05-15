import { useCallback, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, ControlButton, MiniMap,
  useNodesState, useEdgesState, useReactFlow, addEdge, getNodesBounds,
  type Node, type Edge, type Connection, type OnNodesChange, type OnEdgesChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';

import {
  EntityNodeComp, EventNodeComp, EventHandlerNodeComp,
  QueryNodeComp, ActionNodeComp, ActorNodeComp, ServiceNodeComp,
} from './nodes';
import type { Layout } from '../dslToFlow';
import { DiagramCallbackContext } from '../diagramContext';

const nodeTypes = {
  entity: EntityNodeComp,
  event: EventNodeComp,
  eventhandler: EventHandlerNodeComp,
  query: QueryNodeComp,
  action: ActionNodeComp,
  actor: ActorNodeComp,
  service: ServiceNodeComp,
};

const EXPORT_ZOOM = 1.5;
const EXPORT_PADDING = 80;

interface Props {
  nodes: Node[];
  edges: Edge[];
  filename?: string;
  onLayoutChange: (layout: Layout) => void;
  onNodeRightClick?: (nodeId: string, nodeType: string) => void;
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

export function DiagramCanvas({ nodes: propNodes, edges: propEdges, filename, onLayoutChange, onNodeRightClick }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(propNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(propEdges);

  useEffect(() => { setNodes(propNodes); }, [propNodes, setNodes]);
  useEffect(() => { setEdges(propEdges); }, [propEdges, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges],
  );

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
    <DiagramCallbackContext.Provider value={{ onLayoutChange }}>
      <div style={{ flex: 1, height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as OnNodesChange}
          onEdgesChange={onEdgesChange as OnEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={handleNodeDragStop}
          onNodeContextMenu={handleNodeContextMenu}
          nodeTypes={nodeTypes}
          fitView
          panActivationKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#333" gap={16} />
          <Controls>
            <SavePngButton filename={filename ?? 'diagram'} />
          </Controls>
          <MiniMap nodeColor={nodeColor} style={{ background: '#1a1a1a' }} />
        </ReactFlow>
      </div>
    </DiagramCallbackContext.Provider>
  );
}

function nodeColor(node: Node): string {
  switch (node.type) {
    case 'entity': return '#4a7fb5';
    case 'event': return '#c9a800';
    case 'eventhandler': return '#c87020';
    case 'query': return '#3a9e55';
    case 'action': return '#3a9e55';
    case 'actor': return '#8040b0';
    default: return '#555';
  }
}
