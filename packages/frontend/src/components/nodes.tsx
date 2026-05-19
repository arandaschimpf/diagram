import { useCallback, useContext } from 'react';
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react';
import type { DiagramNode, EntityNode, EnumNode, EventNode, EventHandlerNode, QueryNode, ActionNode, ActorNode, StateMachineNode } from '@diagram/parser';
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
  name, fill, stroke, textColor, comment,
}: {
  name: string; fill: string; stroke: string; textColor: string; comment?: string;
}) {
  const w = Math.max(130, name.length * CHAR_W + DIAMOND_PAD * 2);
  const h = DIAMOND_H;
  const mx = w / 2;
  const my = h / 2;
  const pts = `${mx},1 ${w - 1},${my} ${mx},${h - 1} 1,${my}`;

  return (
    <div style={{ width: w }}>
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
      {comment && (
        <div style={{ fontFamily: 'monospace', fontSize: 11, fontStyle: 'italic', color: textColor, textAlign: 'center', paddingTop: 3, whiteSpace: 'pre-wrap' }}>
          {comment}
        </div>
      )}
    </div>
  );
}

// ── Entity (blue rectangle) ───────────────────────────────────────────────────

export function EntityNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EntityNode;
  const hasBody = node.fields.length > 0 || node.constraints.length > 0;
  return (
    <div style={styles.entity}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.entityTitle}>{node.name}</div>
      <div style={styles.entityBody}>
        {node.comment && (
          <>
            <div style={styles.nodeComment}>{node.comment}</div>
            {hasBody && <div style={styles.commentDivider} />}
          </>
        )}
        {node.fields.map(f => (
          <div key={f.name} style={styles.field}>
            <span style={styles.fieldName}>{f.name}{f.optional ? '?' : ''}</span>
            <span style={styles.fieldType}>{f.type.base}{f.type.array ? '[]' : ''}{f.type.nullable ? ' | null' : ''}</span>
          </div>
        ))}
        {node.constraints.length > 0 && (
          <div style={styles.constraints}>
            {node.constraints.map((c, i) => (
              <div key={i} style={styles.constraint}>
                @{c.kind}: [{c.fields.join(', ')}]
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Enum (teal rectangle) ─────────────────────────────────────────────────────

export function EnumNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EnumNode;
  return (
    <div style={styles.enum}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.enumTitle}>{node.name}</div>
      <div style={styles.entityBody}>
        {node.comment && (
          <>
            <div style={styles.nodeComment}>{node.comment}</div>
            {node.variants.length > 0 && <div style={styles.commentDivider} />}
          </>
        )}
        {node.variants.map(v => (
          <div key={v} style={styles.enumVariant}>{v}</div>
        ))}
      </div>
    </div>
  );
}

// ── Event (yellow rectangle) ──────────────────────────────────────────────────

export function EventNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EventNode;
  if (node.payload.length === 0 && !node.comment) {
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
        {node.comment && (
          <>
            <div style={styles.nodeComment}>{node.comment}</div>
            {node.payload.length > 0 && <div style={styles.commentDivider} />}
          </>
        )}
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

// ── EventHandler (orange rectangle) ──────────────────────────────────────────

export function EventHandlerNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as EventHandlerNode;
  if (node.payload.length === 0 && !node.comment) {
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
        {node.comment && (
          <>
            <div style={styles.nodeComment}>{node.comment}</div>
            {node.payload.length > 0 && <div style={styles.commentDivider} />}
          </>
        )}
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
  const hasBody = node.inputs.length > 0 || node.response.length > 0;
  return (
    <div style={styles.query}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.queryTitle}>{node.name}</div>
      {node.comment && (
        <div style={{ ...styles.querySection }}>
          <div style={styles.nodeComment}>{node.comment}</div>
          {hasBody && <div style={styles.commentDivider} />}
        </div>
      )}
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
  const hasBody = node.inputs.length > 0 || node.response.length > 0;
  if (!hasBody) {
    return (
      <DiamondSvg
        name={node.name}
        fill="#f8c8d0"
        stroke="#c04060"
        textColor="#5a1830"
        comment={node.comment}
      />
    );
  }
  return (
    <div style={styles.action}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.actionTitle}>{node.name}</div>
      {node.comment && (
        <div style={styles.querySection}>
          <div style={styles.nodeComment}>{node.comment}</div>
          <div style={styles.commentDivider} />
        </div>
      )}
      {node.inputs.length > 0 && (
        <div style={styles.querySection}>
          <div style={styles.actionSectionLabel}>inputs</div>
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
          <div style={styles.actionSectionLabel}>response</div>
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

// ── Actor ─────────────────────────────────────────────────────────────────────

export function ActorNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as ActorNode;
  return (
    <div style={styles.actor}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.actorIcon}>👤</div>
      <div style={styles.actorLabel}>{node.name}</div>
      {node.comment && <div style={styles.nodeComment}>{node.comment}</div>}
    </div>
  );
}

// ── Service container (resizable) ────────────────────────────────────────────

export function ServiceNodeComp({ id, data, selected }: NodeProps) {
  const { name, external, comment } = data as { name: string; external?: boolean; comment?: string };
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
      <div style={styles.serviceLabel}>
        {name}
        {comment && <div style={styles.serviceLabelComment}>{comment}</div>}
      </div>
    </div>
  );
}

// ── StateMachine (slate compact card) ────────────────────────────────────────

export function StateMachineNodeComp({ data }: NodeProps) {
  const node = (data as NodeData).node as StateMachineNode;
  const { onOpenStateMachine } = useContext(DiagramCallbackContext);
  const transitionCount = node.states.reduce((n, s) => n + s.transitions.length, 0);
  const deprecated = node.tags.includes('deprecated');
  const experimental = node.tags.includes('experimental');
  return (
    <div style={{ ...styles.stateMachine, ...(deprecated ? styles.deprecated : null) }}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div style={styles.stateMachineTitle}>
        <span>
          {node.name}
          {experimental && <span style={styles.tagChip}>experimental</span>}
          {deprecated && <span style={styles.tagChip}>deprecated</span>}
        </span>
        <button
          type="button"
          style={styles.expandBtn}
          onClick={e => {
            e.stopPropagation();
            onOpenStateMachine?.(node);
          }}
          title="Show state machine details"
        >
          ⤢
        </button>
      </div>
      <div style={styles.stateMachineBody}>
        {node.comment && (
          <>
            <div style={styles.nodeComment}>{node.comment}</div>
            <div style={styles.commentDivider} />
          </>
        )}
        <div style={styles.stateBadges}>
          {node.states.map((s, i) => (
            <span key={s.name} style={styles.stateBadgeRow}>
              <span
                style={{
                  ...styles.stateBadge,
                  ...(s.initial ? styles.stateBadgeInitial : null),
                  ...(s.transitions.length === 0 ? styles.stateBadgeTerminal : null),
                }}
              >
                {s.name}
              </span>
              {i < node.states.length - 1 && <span style={styles.stateBadgeArrow}>→</span>}
            </span>
          ))}
        </div>
        <div style={styles.stateMachineFooter}>
          {node.states.length} state{node.states.length === 1 ? '' : 's'} · {transitionCount} transition{transitionCount === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  nodeComment: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontStyle: 'italic',
    color: '#555',
    whiteSpace: 'pre-wrap',
  },
  commentDivider: {
    height: 1,
    background: 'rgba(0,0,0,0.12)',
    margin: '4px 0',
  },

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
  constraints: {
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid #7aaad8',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  constraint: {
    color: '#2a5a8a',
    fontSize: 11,
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
  },

  enum: {
    background: '#c9ebe5',
    border: '1.5px solid #2f8f80',
    borderRadius: 4,
    width: 'max-content',
    minWidth: 180,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
  },
  enumTitle: {
    background: '#2f8f80',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '2px 2px 0 0',
    fontSize: 13,
  },
  enumVariant: {
    color: '#114a42',
    fontWeight: 500,
  },

  event: {
    background: '#fde99a',
    border: '1.5px solid #c9a800',
    borderRadius: 4,
    padding: '6px 14px',
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
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

  action: {
    background: '#f8c8d0',
    border: '1.5px solid #c04060',
    borderRadius: 8,
    minWidth: 150,
    fontFamily: 'monospace',
    fontSize: 12,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  actionTitle: {
    background: '#c04060',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    fontSize: 13,
  },
  actionSectionLabel: { fontSize: 10, color: '#5a1830', textTransform: 'uppercase' as const, marginBottom: 2 },

  actor: {
    background: '#e8d5f5',
    border: '1.5px solid #8040b0',
    borderRadius: 8,
    padding: '8px 16px',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center' as const,
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
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
  serviceLabelComment: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: 400,
    color: '#888',
    letterSpacing: 0,
    marginTop: 2,
    whiteSpace: 'pre-wrap',
  },

  stateMachine: {
    background: '#1e2a38',
    border: '1.5px solid #3d6f9d',
    borderRadius: 6,
    width: 'max-content',
    maxWidth: 460,
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#e6edf3',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  },
  deprecated: { opacity: 0.6 },
  stateMachineTitle: {
    background: '#274d6e',
    color: '#fff',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '4px 4px 0 0',
    fontSize: 13,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  tagChip: {
    fontSize: 10,
    fontWeight: 600,
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.25)',
    color: '#e6edf3',
    padding: '0 4px',
    borderRadius: 3,
    marginLeft: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  expandBtn: {
    background: 'transparent',
    color: '#e6edf3',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 3,
    fontSize: 12,
    padding: '0 6px',
    cursor: 'pointer',
    lineHeight: 1.6,
  },
  stateMachineBody: {
    padding: '6px 10px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  stateBadges: {
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: 4,
    alignItems: 'center',
  },
  stateBadgeRow: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  stateBadge: {
    background: '#1f3a55',
    border: '1px solid #3d6f9d',
    color: '#cfe2f3',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
  },
  stateBadgeInitial: {
    background: '#274d6e',
    borderColor: '#5aa0d4',
    color: '#fff',
  },
  stateBadgeTerminal: {
    background: '#2a2a2a',
    borderColor: '#7a7a7a',
    color: '#cfcfcf',
  },
  stateBadgeArrow: {
    color: '#5aa0d4',
    margin: '0 4px',
    fontSize: 12,
  },
  stateMachineFooter: {
    fontSize: 10,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
};
