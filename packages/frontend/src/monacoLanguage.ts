import type { Monaco } from '@monaco-editor/react';

export const LANG_ID = 'diagram-dsl';

export function registerDiagramLanguage(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === LANG_ID)) return;

  monaco.languages.register({ id: LANG_ID });

  monaco.languages.setMonarchTokensProvider(LANG_ID, {
    keywords: ['Service', 'Entity', 'Event', 'EventHandler', 'Query', 'Action', 'XOR', 'Actor', 'external'],
    typeKeywords: ['string', 'number', 'boolean', 'Date', 'null'],
    tokenizer: {
      root: [
        // Line comments
        [/\/\/.*$/, 'comment'],

        // Keywords
        [/\b(Service|Entity|Event|EventHandler|Query|Action|XOR|Actor|external)\b/, 'keyword'],

        // Primitive / built-in types
        [/\b(string|number|boolean|Date|null)\b/, 'type'],

        // Identifiers (capitalized = type reference, lowercase = field name)
        [/\b[A-Z][A-Za-z0-9_]*\b/, 'type.identifier'],
        [/\b[a-z_][A-Za-z0-9_]*\b/, 'identifier'],

        // Operators and punctuation
        [/[|?:,\[\]{}()]/, 'delimiter'],
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
      const results = findAll(model, new RegExp(`\\b(Entity|EventHandler|Event|Query|Action|XOR|Actor|Service)\\s+${name}\\b`), true);
      return results.length > 0 ? results[0] : null;
    },
  };
  monaco.languages.registerDefinitionProvider(LANG_ID, defProvider);

  monaco.editor.defineTheme('diagram-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',         foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'type',            foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'identifier',      foreground: '9CDCFE' },
      { token: 'delimiter',       foreground: 'D4D4D4' },
      { token: 'comment',         foreground: '6A9955', fontStyle: 'italic' },
    ],
    colors: {},
  });
}
