import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { clike } from "@codemirror/legacy-modes/mode/clike";
import { setDiagnostics, lintGutter, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import type { CompileDiagnostic } from "../core/types";

const wgslWords = (s: string) =>
  s.split(" ").reduce<Record<string, boolean>>((o, w) => ((o[w] = true), o), {});

const wgsl = StreamLanguage.define(clike({
  name: "wgsl",
  keywords: wgslWords(
    "fn let var const if else for while loop break continue return struct switch case default discard true false",
  ),
  types: wgslWords(
    "f32 i32 u32 bool vec2f vec3f vec4f vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 array texture_2d sampler Ctx VOut Uniforms",
  ),
  builtin: wgslWords(
    "sin cos tan atan2 pow exp log sqrt abs sign floor ceil fract min max clamp mix step smoothstep length distance dot cross normalize reflect select textureSampleLevel spec wav pal hash noise fbm ridge hue3 srcTex prevTex",
  ),
}));

const theme = EditorView.theme({
  "&": { backgroundColor: "#050508", color: "#e8e6f0", fontSize: "12.5px", height: "100%" },
  ".cm-content": { fontFamily: "'Consolas','SF Mono',ui-monospace,monospace", caretColor: "#7df2c8" },
  ".cm-gutters": { backgroundColor: "#0f0e18", color: "#4a4860", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(125,242,200,0.04)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(125,242,200,0.06)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "rgba(125,242,200,0.18)" },
  ".cm-lint-marker-error": { content: "none" },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c87df2" },
  { tag: tags.typeName, color: "#7dbdf2" },
  { tag: tags.number, color: "#f2d97d" },
  { tag: tags.comment, color: "#5a5878" },
  { tag: tags.string, color: "#7df2c8" },
  { tag: [tags.standard(tags.variableName), tags.function(tags.variableName)], color: "#7df2c8" },
]);

export class ShaderEditor {
  readonly view: EditorView;
  private readonly readOnly = new Compartment();

  constructor(parent: HTMLElement, initial: string, onChange: (code: string) => void) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          lintGutter(),
          wgsl,
          syntaxHighlighting(highlight),
          theme,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          this.readOnly.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
  }

  get code(): string {
    return this.view.state.doc.toString();
  }

  setCode(code: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: code },
    });
  }

  showDiagnostics(diags: CompileDiagnostic[]): void {
    const doc = this.view.state.doc;
    const cmDiags: Diagnostic[] = diags
      .filter((d) => d.severity !== "info")
      .map((d) => {
        const lineNo = Math.min(Math.max(1, d.line), doc.lines);
        const line = doc.line(lineNo);
        return {
          from: line.from,
          to: line.to,
          severity: d.severity,
          message: d.message,
        };
      });
    this.view.dispatch(setDiagnostics(this.view.state, cmDiags));
  }
}
