import type { Monaco } from '@monaco-editor/react';
import { parse, serialize } from '@diagram/parser';

export const LANG_ID = 'diagram-dsl';

export function registerDiagramLanguage(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === LANG_ID)) return;

  monaco.languages.register({ id: LANG_ID });

  monaco.languages.setMonarchTokensProvider(LANG_ID, {
    keywords: ['Service', 'Entity', 'Enum', 'Event', 'EventHandler', 'Query', 'Action', 'Actor', 'Type', 'StateMachine', 'View', 'external', 'interface', 'implements'],
    typeKeywords: ['string', 'number', 'boolean', 'Date', 'UUID', 'null'],
    tokenizer: {
      root: [
        // Line comments
        [/\/\/.*$/, 'comment'],

        // Constraint and tag annotations (@either, @unique, @deprecated, @experimental, @initial)
        [/@(either|unique|deprecated|experimental|initial)\b/, 'keyword.constraint'],

        // Transition arrow in StateMachine bodies
        [/->/, 'keyword.operator'],

        // Keywords
        [/\b(Service|Entity|Enum|Event|EventHandler|Query|Action|Actor|Type|StateMachine|View|external|interface|implements)\b/, 'keyword'],

        // Primitive / built-in types
        [/\b(string|number|boolean|Date|UUID|null)\b/, 'type'],

        // Identifiers (capitalized = type reference, lowercase = field name)
        [/\b[A-Z][A-Za-z0-9_]*\b/, 'type.identifier'],
        [/\b[a-z_][A-Za-z0-9_]*\b/, 'identifier'],

        // Operators and punctuation
        [/[|?:,\[\]{}()@.]/, 'delimiter'],
      ],
    },
  });

  type Location = import('monaco-editor').languages.Location;

  function findAll(model: import('monaco-editor').editor.ITextModel, pattern: RegExp, stopAtFirst: boolean): Location[] {
    const lines = model.getLinesContent();
    const results: Location[] = [];
    let bracketDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (bracketDepth === 0 && pattern.test(line)) {
        results.push({ uri: model.uri, range: { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: line.length + 1 } });
        if (stopAtFirst) break;
      }
      bracketDepth += (line.match(/\[/g)?.length ?? 0) - (line.match(/\]/g)?.length ?? 0);
    }
    return results;
  }

  const defProvider: import('monaco-editor').languages.DefinitionProvider = {
    provideDefinition(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word || !/^[A-Z]/.test(word.word)) return null;

      const name = word.word;
      const currentLine = model.getLinesContent()[position.lineNumber - 1];

      // Cross-navigation: EventHandler ↔ Event of the same name
      const onEventHandler = new RegExp(`^\\s*EventHandler\\s+${name}\\b`).test(currentLine);
      const onEvent = !onEventHandler && new RegExp(`^\\s*Event\\s+${name}\\b`).test(currentLine);

      if (onEventHandler) {
        // Navigate to Event(s) with the same name — collect all (may be in multiple services)
        const results = findAll(model, new RegExp(`^\\s*Event\\s+${name}\\b`), false);
        return results.length > 0 ? results : null;
      }

      if (onEvent) {
        // Navigate to EventHandler(s) with the same name
        const results = findAll(model, new RegExp(`^\\s*EventHandler\\s+${name}\\b`), false);
        return results.length > 0 ? results : null;
      }

      // Default: go to definition of the type reference under cursor
      const results = findAll(model, new RegExp(`\\b(Entity|Enum|EventHandler|Event|Query|Action|Actor|Service|StateMachine|Type)\\s+${name}\\b`), true);
      return results.length > 0 ? results[0] : null;
    },
  };
  monaco.languages.registerDefinitionProvider(LANG_ID, defProvider);

  const refProvider: import('monaco-editor').languages.ReferenceProvider = {
    provideReferences(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word || !/^[A-Z]/.test(word.word)) return null;
      const name = word.word;
      const lines = model.getLinesContent();
      const pattern = new RegExp(`\\b${name}\\b`);
      const results: Location[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // skip pure comment lines
        if (/^\s*\/\//.test(line)) continue;
        let s = 0;
        while (s < line.length) {
          const tail = line.slice(s);
          const m = tail.match(pattern);
          if (!m || m.index === undefined) break;
          const col = s + m.index + 1;
          results.push({
            uri: model.uri,
            range: {
              startLineNumber: i + 1, startColumn: col,
              endLineNumber: i + 1, endColumn: col + name.length,
            },
          });
          s += m.index + name.length;
        }
      }
      return results;
    },
  };
  monaco.languages.registerReferenceProvider(LANG_ID, refProvider);

  monaco.languages.registerDocumentFormattingEditProvider(LANG_ID, {
    provideDocumentFormattingEdits(model: import('monaco-editor').editor.ITextModel) {
      const text = model.getValue();
      try {
        const formatted = serialize(parse(text));
        if (formatted === text) return [];
        return [{ range: model.getFullModelRange(), text: formatted }];
      } catch {
        return [];
      }
    },
  });

  monaco.editor.defineTheme('diagram-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',            foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'keyword.constraint', foreground: 'C586C0', fontStyle: 'italic' },
      { token: 'keyword.operator',   foreground: 'C586C0' },
      { token: 'type',            foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'identifier',      foreground: '9CDCFE' },
      { token: 'delimiter',       foreground: 'D4D4D4' },
      { token: 'comment',         foreground: '6A9955', fontStyle: 'italic' },
    ],
    colors: {},
  });
}
