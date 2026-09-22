/**
 * Localized copy for the composer input-limit control. Product copy is Chinese;
 * an English dictionary ships alongside for non-zh clients.
 */

export const zh = {
  'chip.label': '输入上限',
  'chip.defaultTag': '默认',
  'chip.ariaAction': '点击修改当前模型的输入上限',
  'chip.title': '当前模型的输入上限',
  'popover.title': '输入上限',
  'popover.hint': '设置当前模型可消耗的上下文窗口，用于上下文占用与自动压缩判断。',
  'field.label': '上下文窗口（tokens）',
  'field.placeholder': '如 128K · 1M · 128000；留空恢复提供方默认',
  'save': '保存',
  'saving': '保存中…',
  'reset': '恢复默认',
  'cancel': '取消',
  'error.invalid': '请输入有效的 token 数（正整数，可带 K/M 后缀）',
} as const

export const en = {
  'chip.label': 'Input limit',
  'chip.defaultTag': 'default',
  'chip.ariaAction': 'Set the input limit of the current model',
  'chip.title': 'Input limit of the current model',
  'popover.title': 'Input limit',
  'popover.hint': 'Set the context window this model may consume, used for context pressure and auto-compaction.',
  'field.label': 'Context window (tokens)',
  'field.placeholder': 'e.g. 128K · 1M · 128000; blank restores the provider default',
  'save': 'Save',
  'saving': 'Saving…',
  'reset': 'Reset to default',
  'cancel': 'Cancel',
  'error.invalid': 'Enter a positive token count (integer, optional K/M suffix)',
} as const

export type InputLimitKey = keyof typeof zh
