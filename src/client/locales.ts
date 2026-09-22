/**
 * Localized copy for the composer input-limit control. Product copy is Chinese;
 * an English dictionary ships alongside for non-zh clients. `en` is typed as a
 * total record over the zh keys, so the two dictionaries cannot drift apart.
 */

export const zh = {
  'chip.label': '输入上限',
  'chip.defaultTag': '默认',
  'chip.ariaAction': '点击修改当前模型的输入上限',
  'chip.title': '当前模型的输入上限',
  'popover.title': '输入上限',
  'popover.hint': '设置当前模型可消耗的上下文窗口，用于上下文占用与自动压缩判断。输入精确 token 数，下方自动换算 K/M。',
  'field.label': '上下文窗口（tokens）',
  'field.placeholder': '如 131072',
  'save': '保存',
  'saving': '保存中…',
  'reset': '恢复默认',
  'cancel': '取消',
  'error.invalid': '请输入正整数 token 数，如 131072（即 128K）',
} as const

export type InputLimitKey = keyof typeof zh

export const en: Record<InputLimitKey, string> = {
  'chip.label': 'Input limit',
  'chip.defaultTag': 'default',
  'chip.ariaAction': 'Set the input limit of the current model',
  'chip.title': 'Input limit of the current model',
  'popover.title': 'Input limit',
  'popover.hint': 'Set the context window this model may consume, used for context pressure and auto-compaction. Type exact tokens; the K/M equivalent appears as you type.',
  'field.label': 'Context window (tokens)',
  'field.placeholder': 'e.g. 131072',
  'save': 'Save',
  'saving': 'Saving…',
  'reset': 'Reset to default',
  'cancel': 'Cancel',
  'error.invalid': 'Enter a positive integer token count, e.g. 131072 (= 128K)',
}
