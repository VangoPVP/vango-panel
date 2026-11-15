"use client";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import type { EditorLanguage } from "@vango-panel/wings/paths";
import { useTheme } from "next-themes";

const LANGUAGES: Record<EditorLanguage, () => Extension[]> = {
  json: () => [json()],
  yaml: () => [yaml()],
  properties: () => [StreamLanguage.define(properties)],
  toml: () => [StreamLanguage.define(toml)],
  shell: () => [StreamLanguage.define(shell)],
  javascript: () => [javascript({ typescript: true })],
  xml: () => [xml()],
  markdown: () => [markdown()],
  text: () => [],
};

export default function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  language: EditorLanguage;
  readOnly?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={LANGUAGES[language]()}
      theme={resolvedTheme === "light" ? "light" : "dark"}
      readOnly={readOnly}
      height="calc(100svh - 18rem)"
      minHeight="20rem"
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, searchKeymap: true }}
      className="text-xs ring-1 ring-foreground/10"
    />
  );
}
