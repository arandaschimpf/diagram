import { useMemo } from 'react';
import { parse, lint } from '@diagram/parser';
import type { Diagnostic } from '@diagram/parser';

export function useDiagnostics(code: string): Diagnostic[] {
  return useMemo(() => {
    try {
      const ast = parse(code);
      return lint(ast);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/at line (\d+)/);
      return [{
        severity: 'error',
        message: msg,
        line: m ? parseInt(m[1], 10) : undefined,
      }];
    }
  }, [code]);
}
