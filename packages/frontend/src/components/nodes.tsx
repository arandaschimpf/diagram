import { useCallback, useContext } from 'react';
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react';
import type { DiagramNode, EntityNode, EventNode, EventHandlerNode, QueryNode, ActionNode, XORNode, ActorNode } from '@diagram/parser';
import { DiagramCallbackContext } from '../diagramContext';
import type { Layout } from '../dslToFlow';

type NodeData = { node: DiagramNode; serviceId: string };

const HANDLE_STYLE: React.CSSProperties = {
  background: '#666',
  width: 8,
  height: 8,
  border: '1px solid #999',
};

// ── Diamond SVG helper ────────────────────────────────────────────────────────

const DIAMOND_H = 72;
const CHAR_W = 8.5;
const DIAMOND_PAD = 48; // horizontal padding from text to tips

function DiamondSvg({
  name, fill, stroke, textColor,
}: {
  name: string; fill: string; stroke: string; textColor: string;
}) {
  const w = Math.max(130, name.length * CHAR_W + DIAMOND_PAD * 2);
  const h = DIAMOND_H;
  const mx = w / 2;
  const my = h / 2;
  // polygon: top, right, bottom, left (vertices at cardinal points)
  const pts = `${mx},1 ${w - 1},${my} ${mx},${h - 1} 1,${my}`;

  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <Handle type="target" position={Position.Left}
        style={{ ...HANDLE_STYLE, left: -4, top: my }} />
      <Handle type="source" position={Position.Right}
        style={{ ...HANDLE_STYLE, right: -4, top: my }} />
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <text
          x={mx} y={my}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fontWeight={700}
          fontFamily="monospace"
          fill={textColor}
        >
          {name}
        </text>
      </svg>
    </div>
  );
}

// ── Entity (blue rectangle) ───────────────────────────────────────────────────

export function EntityNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EntityNode;
  return (
    <div style={styles.entity}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.entityTitle}>{node.name}</div>
      <div style={styles.entityBody}>
        {node.fields.map(f => (
          <div key={f.name} style={styles.field}>
            <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
            <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event (yellow rectangle) ──────────────────────────────────────────────────

export function EventNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EventNode;
  if (node.payload.length === 0) {
    return (
      <div style={styles.event}>
        <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
        <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
        <div style={styles.eventLabel}>{node.name}</div>
      </div>
    );
  }
  return (
    <div style={styles.eventWithPayload}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.eventTitle}>{node.name}</div>
      <div style={styles.entityBody}>
        {node.payload.map(f => (
          <div key={f.name} style={styles.field}>
            <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
            <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── EventHandler (yellow diamond) ────────────────────────────────────────────

export function EventHandlerNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EventHandlerNode;
  if (node.payload.length === 0) {
    return (
      <div style={styles.eventHandler}>
        <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
        <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
        <div style={styles.eventHandlerLabel}>{node.name}</div>
      </div>
    );
  }
  return (
    <div style={styles.eventHandlerWithPayload}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.eventHandlerTitle}>{node.name}</div>
      <div style={styles.entityBody}>
        {node.payload.map(f => (
          <div key={f.name} style={styles.field}>
            <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
            <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Query (green rectangle) ───────────────────────────────────────────────────

export function QueryNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as QueryNode;
  return (
    <div style={styles.query}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.queryTitle}>{node.name}</div>
      {node.inputs.length > 0 && (
        <div style={styles.querySection}>
          <div style={styles.sectionLabel}>inputs</div>
          {node.inputs.map(f => (
            <div key={f.name} style={styles.field}>
              <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
              <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
            </div>
          ))}
        </div>
      )}
      {node.response.length > 0 && (
        <div style={styles.querySection}>
          <div style={styles.sectionLabel}>response</div>
          {node.response.map(f => (
            <div key={f.name} style={styles.field}>
              <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
              <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Action (green diamond) ────────────────────────────────────────────────────

export function ActionNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as ActionNode;
  return (
    <DiamondSvg
      name={node.name}
      fill="#b8e8c0"
      stroke="#3a9e55"
      textColor="#1a5a30"
    />
  );
}

// ── XOR (pink rounded rect) ───────────────────────────────────────────────────

export function XORNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as XORNode;
  return (
    <div style={styles.xor}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.xorLabel}>XOR: {node.name}</div>
      <div style={styles.xorOptions}>{node.options.join(' | ')}</div>
    </div>
  );
}

// ── Service container (resizable) ────────────────────────────────────────────

// ── Actor ─────────────────────────────────────────────────────────────────────

export function ActorNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as ActorNode;
  return (
    <div style={styles.actor}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.actorIcon}>👤</div>
      <div style={styles.actorLabel}>{node.name}</div>
    </div>
  );
}

// ── Service container (resizable) ────────────────────────────────────────────

export function ServiceNodeComp({ id, data, selected }: NodeProps) {
  const { name, external } = data as { name: string; external?: boolean };
  const { onLayoutChange } = useContext(DiagramCallbackContext);
  const { getNodes } = useReactFlow();

  const handleResizeEnd = useCallback(
    (_: unknown, params: { x: number; y: number; width: number; height: number }) => {
      const allNodes = getNodes();
      const layout: Layout = {};
      allNodes.forEach(n => {
        const entry: Layout[string] = { x: n.position.x, y: n.position.y };
        if (n.type === 'service') {
          const w = n.style?.width;
          const h = n.style?.height;
          if (typeof w === 'number') entry.width = w;
          if (typeof h === 'number') entry.height = h;
        }
        layout[n.id] = entry;
      });
      layout[id] = { x: params.x, y: params.y, width: params.width, height: params.height };
      onLayoutChange(layout);
    },
    [id, getNodes, onLayoutChange],
  );

  return (
    <div style={external ? styles.serviceExternal : styles.service}>
      <NodeResizer
        isVisible={selected}
        minWidth={300}
        minHeight={200}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ stroke: '#666', strokeWidth: 1 }}
        handleStyle={{ width: 10, height: 10, borderRadius: 2, background: '#444', border: '1px solid #888' }}
      />
      <div style={styles.serviceLabel}>{name}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  entity: {
    background: '#b8d4f0',
    border: '1.5px solid #4a7fb5',
    borderRadius: 4,
    width: 'max-content',
    minWidth: 220,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
  },
  entityTitle: {
    background: '#4a7fb5',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '2px 2px 0 0',
    fontSize: 13,
  },
  entityBody: {
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    whiteSpace: 'nowrap',
  },
  fieldName: { color: '#1a3a5c', fontWeight: 600, flexShrink: 0 },
  fieldType: { color: '#4a6a8a', whiteSpace: 'nowrap' },

  event: {
    background: '#fde99a',
    border: '1.5px solid #c9a800',
    borderRadius: 4,
    padding: '6px 14px',
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    whiteSpace: 'nowrap',
  },
  eventLabel: { fontWeight: 600, color: '#5a4800' },

  eventHandler: {
    background: '#fddcb0',
    border: '1.5px solid #c87020',
    borderRadius: 4,
    padding: '6px 14px',
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    whiteSpace: 'nowrap',
  },
  eventHandlerLabel: { fontWeight: 600, color: '#6a3800' },
  eventHandlerWithPayload: {
    background: '#fddcb0',
    border: '1.5px solid #c87020',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    minWidth: 220,
    width: 'max-content',
  },
  eventHandlerTitle: {
    background: '#c87020',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '2px 2px 0 0',
    fontSize: 13,
  },
  eventWithPayload: {
    background: '#fde99a',
    border: '1.5px solid #c9a800',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    minWidth: 220,
    width: 'max-content',
  },
  eventTitle: {
    background: '#c9a800',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '2px 2px 0 0',
    fontSize: 13,
  },

  query: {
    background: '#b8e8c0',
    border: '1.5px solid #3a9e55',
    borderRadius: 8,
    minWidth: 150,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  queryTitle: {
    background: '#3a9e55',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    fontSize: 13,
  },
  querySection: { padding: '4px 10px 6px' },
  sectionLabel: { fontSize: 10, color: '#1a5a30', textTransform: 'uppercase', marginBottom: 2 },

  xor: {
    background: '#f8c8d0',
    border: '1.5px solid #d05070',
    borderRadius: 16,
    padding: '6px 14px',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center',
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
  },
  xorLabel: { fontWeight: 700, color: '#7a1030' },
  xorOptions: { color: '#a04060', fontSize: 11, marginTop: 2 },

  actor: {
    background: '#e8d5f5',
    border: '1.5px solid #8040b0',
    borderRadius: 8,
    padding: '8px 16px',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center' as const,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    whiteSpace: 'nowrap',
  },
  actorIcon: { fontSize: 20, marginBottom: 2 },
  actorLabel: { fontWeight: 700, color: '#4a1a7a' },

  service: {
    width: '100%',
    height: '100%',
    border: '2px solid #555',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.03)',
    position: 'relative',
  },
  serviceExternal: {
    width: '100%',
    height: '100%',
    border: '2px dashed #777',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.01)',
    position: 'relative',
  },
  serviceLabel: {
    position: 'absolute',
    top: -14,
    left: 16,
    background: '#1a1a1a',
    padding: '0 8px',
    fontSize: 13,
    fontWeight: 700,
    color: '#aaa',
    letterSpacing: 1,
  },
};
