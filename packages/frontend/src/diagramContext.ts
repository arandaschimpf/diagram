import { createContext } from 'react';
import type { StateMachineNode } from '@diagram/parser';
import type { Layout } from './dslToFlow';

export const DiagramCallbackContext = createContext<{
  onLayoutChange: (layout: Layout) => void;
  onOpenStateMachine?: (node: StateMachineNode) => void;
}>({ onLayoutChange: () => {} });
