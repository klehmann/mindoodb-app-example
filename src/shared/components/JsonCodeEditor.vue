<script setup lang="ts">
import { json } from "@codemirror/lang-json";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const host = ref<HTMLDivElement | null>(null);
const readOnlyCompartment = new Compartment();
let view: EditorView | null = null;

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      json(),
      readOnlyCompartment.of(EditorState.readOnly.of(Boolean(props.readOnly))),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          height: "100%",
          color: "var(--text)",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          fontFamily: "\"SFMono-Regular\", ui-monospace, Menlo, monospace",
          minHeight: `${props.minHeight ?? 220}px`,
        },
        ".cm-content": {
          padding: "12px 14px",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--border)",
        },
        ".cm-activeLineGutter, .cm-activeLine": {
          backgroundColor: "rgba(93, 139, 255, 0.08)",
        },
        ".cm-focused": {
          outline: "none",
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit("update:modelValue", update.state.doc.toString());
        }
      }),
    ],
  });
}

onMounted(() => {
  if (!host.value) {
    return;
  }

  view = new EditorView({
    state: createState(props.modelValue),
    parent: host.value,
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  },
);

watch(
  () => props.readOnly,
  (value) => {
    if (!view) {
      return;
    }
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(Boolean(value))),
    });
  },
);

onBeforeUnmount(() => {
  view?.destroy();
});
</script>

<template>
  <div class="json-code-editor" ref="host" :data-placeholder="placeholder" />
</template>

<style scoped>
.json-code-editor {
  min-height: 100%;
}
</style>
