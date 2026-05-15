import { createContext } from 'react';
import type { Layout } from './dslToFlow';

export const DiagramCallbackContext = createContext<{
  onLayoutChange: (layout: Layout) => void;
}>({ onLayoutChange: () => {} });
